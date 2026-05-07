# YOLO Export Skeleton

`ml/scripts/convert_labels.py` writes YOLO detection exports here. The default target dataset is:

```text
ml/datasets/yolo/card_condition_vault/
```

The export creates `dataset.yaml`, split image folders, split label folders, and one `.txt` label file per manifest image. `clean_card` is excluded from YOLO classes by default and produces an empty label file when the image is exported.

Generated image copies and label files are local artifacts and should usually remain untracked.
