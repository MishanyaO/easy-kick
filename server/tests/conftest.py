import base64

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from easy_kick.config import Settings
from easy_kick.main import create_app


@pytest.fixture(scope="session")
def rsa_keys():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_key, public_pem


def sign(private_key, message_id: str, timestamp: str, body: bytes) -> str:
    message = f"{message_id}.{timestamp}.".encode() + body
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode()


@pytest.fixture
def app(rsa_keys):
    _, public_pem = rsa_keys
    settings = Settings(client_id="test-client", client_secret="test-secret",
                        redirect_uri="http://testserver/auth/callback", buffer_size=50)
    application = create_app(settings)
    application.state.verifier.set_key(public_pem)
    return application


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


def authorize(app, access_token: str = "tok", expires_in: int = 3600) -> None:
    app.state.tokens.store({"access_token": access_token, "expires_in": expires_in})


@pytest.fixture
async def mock_kick(app):
    """Point the app's outbound HTTP (and KickClient) at a MockTransport handler."""
    created: list[httpx.AsyncClient] = []

    def install(handler):
        c = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        app.state.http = c
        app.state.kick._http = c
        created.append(c)

    yield install
    for c in created:
        await c.aclose()
