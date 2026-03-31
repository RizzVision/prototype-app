"""
Stage 3 - K-means Colour Extraction

Extract the dominant colour from each garment mask using K-means clustering
in CIELAB colour space. LAB is perceptually uniform - equal numerical distance
equals equal visual difference, making clustering results match human perception.
"""

import logging

import numpy as np
from sklearn.cluster import KMeans
from skimage import color as skcolor

from app.core.config import settings
from app.services.garment_segmentation import GarmentRegion

logger = logging.getLogger(__name__)

# Cap pixel count fed to KMeans. A garment mask on a 512×512 image can contain
# 80 000+ pixels; KMeans with n_init restarts scales O(N·k·iter).
# 4 000 pixels captures the colour distribution with negligible accuracy loss.
_MAX_KMEANS_PIXELS = 4_000
_RNG = np.random.default_rng(42)


def extract_dominant_color(image_array: np.ndarray, mask: np.ndarray, k: int = None) -> str | None:
    """
    Extract the dominant colour from a masked region of an image.

    Args:
        image_array: RGB image as numpy array (H, W, 3), uint8.
        mask: Boolean mask (H, W) indicating the garment region.
        k: Number of K-means clusters. Defaults to settings.KMEANS_CLUSTERS.

    Returns:
        Hex colour string (e.g., '#4A7B3C') or None if not enough pixels.
    """
    if k is None:
        k = settings.KMEANS_CLUSTERS

    # Extract pixels under the mask
    pixels = image_array[mask]  # Shape: (N, 3)

    # Remove near-black pixels that are mask artifacts
    pixels = pixels[pixels.sum(axis=1) > 30]

    if len(pixels) < 50:
        logger.warning("Too few pixels under mask for reliable colour extraction")
        return None

    # Subsample before KMeans — colour distribution is stable at 4 000 points
    if len(pixels) > _MAX_KMEANS_PIXELS:
        idx = _RNG.choice(len(pixels), _MAX_KMEANS_PIXELS, replace=False)
        pixels = pixels[idx]

    # Convert to float [0, 1] for LAB conversion
    pixels_f = pixels.astype(np.float32) / 255.0

    # Convert RGB to LAB colour space
    # skcolor.rgb2lab expects (M, N, 3), so reshape to (1, N, 3) then back
    lab = skcolor.rgb2lab(pixels_f.reshape(1, -1, 3)).reshape(-1, 3)

    # Run K-means in LAB space
    # n_init=2 is sufficient with a fixed random_state; 5 restarts give negligible gain
    n_clusters = min(k, len(pixels))
    km = KMeans(n_clusters=n_clusters, n_init=2, random_state=42)
    km.fit(lab)

    # Find the largest cluster (dominant colour)
    counts = np.bincount(km.labels_)
    dominant_lab = km.cluster_centers_[counts.argmax()]

    # Convert back to RGB
    rgb = (
        np.clip(skcolor.lab2rgb([[dominant_lab]])[0][0], 0, 1) * 255
    ).astype(np.uint8)

    hex_color = "#{:02X}{:02X}{:02X}".format(*rgb)
    logger.info(f"Extracted dominant colour: {hex_color}")
    return hex_color


def extract_colors_for_garments(
    image_array: np.ndarray, regions: list[GarmentRegion]
) -> list[dict]:
    """
    Extract dominant colours for all detected garment regions.

    Args:
        image_array: RGB image as numpy array (H, W, 3).
        regions: List of GarmentRegion objects from segmentation.

    Returns:
        List of dicts with keys: label, display_name, hex_color.
    """
    results = []
    for region in regions:
        hex_color = extract_dominant_color(image_array, region.mask)
        mask_area = int(region.mask.sum())
        results.append({
            "label": region.label,
            "display_name": region.display_name,
            "hex_color": hex_color,
            "mask_area": mask_area,
        })
        logger.info(f"Garment '{region.label}' -> {hex_color} (area={mask_area}px)")

    return results
