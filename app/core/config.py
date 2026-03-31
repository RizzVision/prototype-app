import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings loaded from environment variables."""

    # Gemini
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Image processing
    IMAGE_MAX_DIMENSION: int = int(os.getenv("IMAGE_MAX_DIMENSION", "4000"))
    IMAGE_TARGET_SIZE: int = int(os.getenv("IMAGE_TARGET_SIZE", "512"))
    IMAGE_MIN_DIMENSION: int = int(os.getenv("IMAGE_MIN_DIMENSION", "100"))

    # Quality gate thresholds
    BRIGHTNESS_MIN: int = int(os.getenv("BRIGHTNESS_MIN", "40"))
    BRIGHTNESS_MAX: int = int(os.getenv("BRIGHTNESS_MAX", "230"))
    SHARPNESS_MIN: int = int(os.getenv("SHARPNESS_MIN", "100"))

    # Color extraction
    KMEANS_CLUSTERS: int = int(os.getenv("KMEANS_CLUSTERS", "3"))

    # Segmentation model
    SEGMENTATION_MODEL: str = os.getenv(
        "SEGMENTATION_MODEL", "mattmdjaga/segformer_b2_clothes"
    )

    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
