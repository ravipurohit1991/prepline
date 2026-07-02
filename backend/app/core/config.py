from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, overridable via PREPLINE_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="PREPLINE_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./prepline.db"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    seed_on_empty: bool = True
