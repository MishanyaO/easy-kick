import base64

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


class SignatureVerifier:
    """Verifies Kick webhook signatures: RSA-SHA256 over 'message_id.timestamp.body'."""

    def __init__(self):
        self._key = None

    @property
    def has_key(self) -> bool:
        return self._key is not None

    def set_key(self, pem: str) -> None:
        self._key = serialization.load_pem_public_key(pem.encode())

    def verify(self, message_id: str, timestamp: str, body: bytes, signature_b64: str) -> bool:
        if self._key is None:
            raise RuntimeError("verification key not loaded")
        message = f"{message_id}.{timestamp}.".encode() + body
        try:
            signature = base64.b64decode(signature_b64, validate=True)
            self._key.verify(signature, message, padding.PKCS1v15(), hashes.SHA256())
            return True
        except (InvalidSignature, ValueError):
            return False
