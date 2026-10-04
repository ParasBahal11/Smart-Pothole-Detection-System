import json
import os
import threading

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

# Lightweight TFLite runtime (no full TensorFlow) so the service fits in Render's free 512 MB RAM.
try:
    from ai_edge_litert.interpreter import Interpreter
except Exception as e:  # pragma: no cover
    print('LiteRT import failed:', e)
    Interpreter = None

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.getenv('MODEL_PATH', os.path.join(BASE_DIR, 'model', 'pothole_classifier.tflite'))
# Old deployments may still have MODEL_PATH pointing at the .keras file; use the .tflite next to it.
if MODEL_PATH.lower().endswith('.keras'):
    MODEL_PATH = MODEL_PATH[: -len('.keras')] + '.tflite'
if not os.path.isabs(MODEL_PATH):
    MODEL_PATH = os.path.join(BASE_DIR, MODEL_PATH)

MIN_POTHOLE_CONFIDENCE = 0.75
threshold = MIN_POTHOLE_CONFIDENCE
threshold_path = os.path.join(os.path.dirname(MODEL_PATH), 'threshold.json')
if os.path.exists(threshold_path):
    try:
        with open(threshold_path, encoding='utf-8') as f:
            threshold = max(MIN_POTHOLE_CONFIDENCE, float(json.load(f).get('threshold', MIN_POTHOLE_CONFIDENCE)))
    except Exception as e:
        print('Threshold load failed:', e)

interpreter = None
input_index = output_index = None
lock = threading.Lock()  # a TFLite interpreter is not thread-safe

if Interpreter and os.path.exists(MODEL_PATH):
    try:
        interpreter = Interpreter(model_path=MODEL_PATH, num_threads=1)
        interpreter.allocate_tensors()
        input_index = interpreter.get_input_details()[0]['index']
        output_index = interpreter.get_output_details()[0]['index']
        print('Loaded TFLite model:', MODEL_PATH)
    except Exception as e:
        interpreter = None
        print('Model load failed:', e)
else:
    print('No TFLite model found at', MODEL_PATH, '- run training/train.py (it exports the .tflite file).')


@app.get('/')
@app.get('/health')
def health():
    return jsonify({'ok': True, 'model_loaded': interpreter is not None, 'model_path': MODEL_PATH, 'threshold': threshold})


@app.post('/predict')
def predict():
    if 'file' not in request.files:
        return jsonify({'message': 'file required'}), 400
    if interpreter is None:
        return jsonify({'detected': False, 'label': 'model_not_loaded', 'confidence': 0, 'boxes': [],
                        'warning': 'Place pothole_classifier.tflite in ai_model/model'}), 503
    try:
        img = Image.open(request.files['file']).convert('RGB').resize((224, 224))
        x = np.expand_dims(np.asarray(img, dtype=np.float32), 0)
        with lock:
            interpreter.set_tensor(input_index, x)
            interpreter.invoke()
            conf = float(interpreter.get_tensor(output_index)[0][0])
        detected = conf >= threshold
        return jsonify({'detected': detected, 'label': 'pothole' if detected else 'normal',
                        'confidence': conf if detected else 1 - conf, 'boxes': []})
    except Exception as e:
        return jsonify({'message': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 8000)), debug=os.getenv('FLASK_DEBUG', '0') == '1')
