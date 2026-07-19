from pathlib import Path

from easy_kick import config


def test_env_file_is_anchored_to_project_root():
    env_file = Path(config.Settings.model_config["env_file"])
    assert env_file == config.PROJECT_ROOT / ".env"
    # PROJECT_ROOT must be the directory that holds pyproject.toml.
    assert (config.PROJECT_ROOT / "pyproject.toml").exists()
