try:
    from django.apps import AppConfig
except Exception:
    # Fallback minimal AppConfig for environments where Django isn't installed
    class AppConfig:
        """Minimal stub to avoid import errors in non-Django environments or linters."""
        pass


class ClarityAppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'clarity_app'