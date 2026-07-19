import pytest

from easy_kick.security import SignatureVerifier
from tests.conftest import sign


def test_valid_signature_accepted(rsa_keys):
    private_key, public_pem = rsa_keys
    verifier = SignatureVerifier()
    verifier.set_key(public_pem)
    sig = sign(private_key, "id-1", "2026-07-18T12:00:00Z", b'{"a":1}')
    assert verifier.verify("id-1", "2026-07-18T12:00:00Z", b'{"a":1}', sig) is True


def test_tampered_body_rejected(rsa_keys):
    private_key, public_pem = rsa_keys
    verifier = SignatureVerifier()
    verifier.set_key(public_pem)
    sig = sign(private_key, "id-1", "2026-07-18T12:00:00Z", b'{"a":1}')
    assert verifier.verify("id-1", "2026-07-18T12:00:00Z", b'{"a":2}', sig) is False


def test_garbage_signature_rejected(rsa_keys):
    _, public_pem = rsa_keys
    verifier = SignatureVerifier()
    verifier.set_key(public_pem)
    assert verifier.verify("id-1", "ts", b"{}", "not base64!!") is False


def test_verify_without_key_raises():
    with pytest.raises(RuntimeError):
        SignatureVerifier().verify("id", "ts", b"{}", "sig")
