import sys
from pathlib import Path

import cv2
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from synthetic import make_logo, write_video  # noqa: E402


@pytest.fixture(scope="session")
def assets(tmp_path_factory):
    d = tmp_path_factory.mktemp("assets")
    logo = make_logo()
    cv2.imwrite(str(d / "logo.png"), logo)
    write_video(d / "video.mp4", logo)
    return d
