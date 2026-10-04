from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import numpy as np, os
try:
 import tensorflow as tf
except Exception as e:
 tf=None
app=Flask(__name__);CORS(app)
MODEL_PATH=os.getenv('MODEL_PATH',os.path.join(os.path.dirname(__file__),'model','pothole_classifier.keras'))
model=None
MIN_POTHOLE_CONFIDENCE=0.75
threshold=MIN_POTHOLE_CONFIDENCE
threshold_path=os.path.join(os.path.dirname(MODEL_PATH),'threshold.json')
if os.path.exists(threshold_path):
 try:
  import json
  with open(threshold_path,encoding='utf-8') as threshold_file:
   trained_threshold=float(json.load(threshold_file).get('threshold',MIN_POTHOLE_CONFIDENCE))
   threshold=max(MIN_POTHOLE_CONFIDENCE,trained_threshold)
 except Exception as e: print('Threshold load failed:',e)
if tf and os.path.exists(MODEL_PATH):
 try: model=tf.keras.models.load_model(MODEL_PATH); print('Loaded TensorFlow model:',MODEL_PATH)
 except Exception as e: print('Model load failed:',e)
else: print('No trained model found. Run training/train.py first.')
@app.get('/health')
def health(): return jsonify({'ok':True,'model_loaded':model is not None,'model_path':MODEL_PATH,'threshold':threshold})
@app.post('/predict')
def predict():
 if 'file' not in request.files:return jsonify({'message':'file required'}),400
 if model is None:return jsonify({'detected':False,'label':'model_not_loaded','confidence':0,'boxes':[],'warning':'Train/export pothole_classifier.keras and place it in ai_model/model'}),503
 try:
  img=Image.open(request.files['file']).convert('RGB').resize((224,224)); x=np.asarray(img,dtype=np.float32); pred=model.predict(np.expand_dims(x,0),verbose=0)[0][0]; conf=float(pred); detected=conf>=threshold
  return jsonify({'detected':detected,'label':'pothole' if detected else 'normal','confidence':conf if detected else 1-conf,'boxes':[]})
 except Exception as e:return jsonify({'message':str(e)}),500
if __name__=='__main__': app.run(host='0.0.0.0',port=int(os.getenv('PORT',8000)),debug=os.getenv('FLASK_DEBUG','0')=='1')
