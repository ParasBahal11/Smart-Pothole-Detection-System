# TensorFlow model
This service loads `model/pothole_classifier.keras`. Train a binary pothole/normal classifier with MobileNetV2 transfer learning, augmentation, and fine-tuning:

1. Add independently collected, correctly labeled images to `dataset/train`, `dataset/val`, and `dataset/test`, each with `normal/` and `pothole/` subfolders.
2. Keep every source image in exactly one split. The training script checks file hashes and stops if it finds duplicates across splits.
3. Install `requirements.txt` and run `python training/train.py`.

Training writes the best checkpoint to `model/pothole_classifier.keras`, the test-set accuracy, precision, recall, F1-score and confusion matrix to `model/evaluation.json`, and the validation-selected threshold to `model/threshold.json`. The Flask service uses the same MobileNetV2 preprocessing as training and never uses a threshold below 0.75, even if validation selects a lower one. The API backend independently rejects any reported pothole detection below 75% confidence.

The images currently included in this repository are only a few per class, and the existing validation images duplicate the training images. They cannot support reliable performance claims. Replace them with a substantially larger, varied dataset and a separate held-out test set before interpreting the metrics. Results are measured on that test split; no accuracy level is guaranteed.
