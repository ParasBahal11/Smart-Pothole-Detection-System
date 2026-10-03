import hashlib
import json
import os
import pathlib
import warnings

import numpy as np
import tensorflow as tf


ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'dataset'
OUTPUT_DIR = ROOT / 'model'
MODEL_PATH = OUTPUT_DIR / 'pothole_classifier.keras'
CLASS_NAMES = ['normal', 'pothole']
IMAGE_SIZE = (224, 224)
BATCH_SIZE = int(os.getenv('BATCH_SIZE', '16'))
SEED = 42

tf.keras.utils.set_random_seed(SEED)


def validate_dataset():
	split_files = {}
	content_hashes = {}

	for split in ('train', 'val', 'test'):
		split_dir = DATA_DIR / split
		if not split_dir.is_dir():
			raise FileNotFoundError(
				f'Missing {split_dir}. Add separate normal/ and pothole/ image folders for each split.'
			)

		split_files[split] = {}
		for class_name in CLASS_NAMES:
			class_dir = split_dir / class_name
			files = sorted(
				path for path in class_dir.rglob('*')
				if path.is_file() and path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.jfif'}
			) if class_dir.is_dir() else []
			if not files:
				raise ValueError(f'No images found in {class_dir}')
			split_files[split][class_name] = files

			for image_path in files:
				image_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
				previous = content_hashes.get(image_hash)
				if previous:
					raise ValueError(
						f'Dataset leakage: {image_path} is a duplicate of {previous}. '
						'Keep each source image in only one split.'
					)
				content_hashes[image_hash] = image_path

	for split, classes in split_files.items():
		counts = {name: len(files) for name, files in classes.items()}
		print(f'{split} images: {counts}')
		if min(counts.values()) < 100:
			warnings.warn(
				f'{split} has fewer than 100 images in at least one class. '
				'Treat its metrics as preliminary and collect more varied, independently sourced images.',
				stacklevel=1,
			)

	return split_files


def load_dataset(split, shuffle):
	dataset = tf.keras.utils.image_dataset_from_directory(
		DATA_DIR / split,
		class_names=CLASS_NAMES,
		image_size=IMAGE_SIZE,
		batch_size=BATCH_SIZE,
		label_mode='binary',
		shuffle=shuffle,
		seed=SEED,
	)
	return dataset.prefetch(tf.data.AUTOTUNE)


def build_model():
	augmentation = tf.keras.Sequential(
		[
			tf.keras.layers.RandomFlip('horizontal'),
			tf.keras.layers.RandomRotation(0.05),
			tf.keras.layers.RandomZoom(0.1),
			tf.keras.layers.RandomContrast(0.1),
		],
		name='road_image_augmentation',
	)
	base = tf.keras.applications.MobileNetV2(
		input_shape=(*IMAGE_SIZE, 3), include_top=False, weights='imagenet'
	)
	base.trainable = False

	inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
	x = augmentation(inputs)
	x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
	x = base(x, training=False)
	x = tf.keras.layers.GlobalAveragePooling2D()(x)
	x = tf.keras.layers.Dropout(0.3)(x)
	outputs = tf.keras.layers.Dense(1, activation='sigmoid')(x)
	return tf.keras.Model(inputs, outputs), base


def callbacks(checkpoint_path):
	return [
		tf.keras.callbacks.ModelCheckpoint(
			checkpoint_path, monitor='val_loss', save_best_only=True, verbose=1
		),
		tf.keras.callbacks.EarlyStopping(
			monitor='val_loss', patience=4, restore_best_weights=True, verbose=1
		),
		tf.keras.callbacks.ReduceLROnPlateau(
			monitor='val_loss', factor=0.2, patience=2, min_lr=1e-7, verbose=1
		),
	]


def probabilities(model, dataset):
	labels = np.concatenate([labels.numpy().reshape(-1) for _, labels in dataset]).astype(int)
	scores = model.predict(dataset, verbose=0).reshape(-1)
	return labels, scores


def binary_metrics(labels, scores, threshold):
	predictions = scores >= threshold
	true_positive = int(np.sum((labels == 1) & predictions))
	true_negative = int(np.sum((labels == 0) & ~predictions))
	false_positive = int(np.sum((labels == 0) & predictions))
	false_negative = int(np.sum((labels == 1) & ~predictions))
	precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
	recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
	f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
	accuracy = (true_positive + true_negative) / len(labels) if len(labels) else 0.0
	return {
		'accuracy': accuracy,
		'precision': precision,
		'recall': recall,
		'f1_score': f1,
		'confusion_matrix': [[true_negative, false_positive], [false_negative, true_positive]],
		'support': {'normal': int(np.sum(labels == 0)), 'pothole': int(np.sum(labels == 1))},
	}


def choose_threshold(labels, scores):
	candidates = np.unique(np.concatenate(([0.5], scores)))
	return max(
		candidates,
		key=lambda threshold: (
			binary_metrics(labels, scores, threshold)['f1_score'],
			-abs(float(threshold) - 0.5),
		),
	)


def main():
	split_files = validate_dataset()
	train_data = load_dataset('train', shuffle=True)
	val_data = load_dataset('val', shuffle=False)
	test_data = load_dataset('test', shuffle=False)
	OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

	model, base = build_model()
	model.compile(
		optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
		loss='binary_crossentropy',
	)
	head_path = OUTPUT_DIR / 'head_best.keras'
	model.fit(
		train_data,
		validation_data=val_data,
		epochs=int(os.getenv('HEAD_EPOCHS', '15')),
		callbacks=callbacks(head_path),
	)
	head_model = tf.keras.models.load_model(head_path)
	head_val_loss = head_model.evaluate(val_data, verbose=0, return_dict=True)['loss']

	base.trainable = True
	for layer in base.layers[:-30]:
		layer.trainable = False
	for layer in base.layers:
		if isinstance(layer, tf.keras.layers.BatchNormalization):
			layer.trainable = False
	model.compile(
		optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
		loss='binary_crossentropy',
	)
	fine_path = OUTPUT_DIR / 'fine_tuned_best.keras'
	model.fit(
		train_data,
		validation_data=val_data,
		epochs=int(os.getenv('FINE_TUNE_EPOCHS', '10')),
		callbacks=callbacks(fine_path),
	)
	fine_model = tf.keras.models.load_model(fine_path)
	fine_val_loss = fine_model.evaluate(val_data, verbose=0, return_dict=True)['loss']
	best_model = fine_model if fine_val_loss <= head_val_loss else head_model

	val_labels, val_scores = probabilities(best_model, val_data)
	threshold = float(choose_threshold(val_labels, val_scores))
	test_labels, test_scores = probabilities(best_model, test_data)
	metrics = binary_metrics(test_labels, test_scores, threshold)
	best_model.save(MODEL_PATH)

	evaluation = {
		'evaluation_split': 'test',
		'threshold_selected_on': 'val',
		'threshold': threshold,
		'model_stage': 'fine_tuned' if best_model is fine_model else 'frozen_feature_extractor',
		'validation_loss': min(head_val_loss, fine_val_loss),
		'metrics': metrics,
		'image_counts': {
			split: {name: len(files) for name, files in classes.items()}
			for split, classes in split_files.items()
		},
		'warning': 'Metrics are dataset-specific. Use a large, independently sourced test set for performance claims.',
	}
	(OUTPUT_DIR / 'evaluation.json').write_text(json.dumps(evaluation, indent=2), encoding='utf-8')
	(OUTPUT_DIR / 'threshold.json').write_text(json.dumps({'threshold': threshold}, indent=2), encoding='utf-8')
	print(json.dumps(evaluation, indent=2))
	print(f'Saved model to {MODEL_PATH}')


if __name__ == '__main__':
	main()
