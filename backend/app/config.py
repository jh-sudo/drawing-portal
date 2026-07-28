from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


_DEFAULT_SYMBOLS_PATH = str(Path(__file__).parent.parent / "symbols")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    symbols_path: str = _DEFAULT_SYMBOLS_PATH
    app_version: str = "1.0.0"
    slack_feedback_webhook_url: str = ""

    @property
    def symbols_dir(self) -> Path:
        return Path(self.symbols_path)

    @property
    def manifest_path(self) -> Path:
        return self.symbols_dir / "manifest.json"


settings = Settings()
