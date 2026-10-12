"""Verificación de sesión con Firebase Auth (login con Google).

El cliente envía `Authorization: Bearer <ID token de Firebase>`; aquí se
valida con firebase-admin. Configuración por variables de entorno:

    GOOGLE_APPLICATION_CREDENTIALS  ruta al JSON de la cuenta de servicio
    FIREBASE_PROJECT_ID             alternativa sin cuenta de servicio (solo verifica tokens)
    ALLOWED_EMAILS                  opcional, lista separada por comas
    ALLOWED_DOMAIN                  opcional, p.ej. "midominio.cl"
    AUTH_DISABLED=1                 solo para desarrollo local: no exige token
"""
import os
from functools import wraps
from typing import Any, Callable, Dict, Optional

import firebase_admin
from firebase_admin import auth as fb_auth
from flask import g, jsonify, request

AUTH_DISABLED = os.environ.get("AUTH_DISABLED") == "1"
ALLOWED_EMAILS = {e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}
ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "").strip().lower()

_app: Optional[firebase_admin.App] = None


def _firebase() -> firebase_admin.App:
    global _app
    if _app is None:
        # Las credenciales por defecto se cargan solo si se usan; verificar ID
        # tokens solo requiere conocer el proyecto.
        project_id = os.environ.get("FIREBASE_PROJECT_ID")
        _app = firebase_admin.initialize_app(options={"projectId": project_id} if project_id else None)
    return _app


def _allowed(email: str) -> bool:
    if not ALLOWED_EMAILS and not ALLOWED_DOMAIN:
        return True
    email = email.lower()
    return email in ALLOWED_EMAILS or (bool(ALLOWED_DOMAIN) and email.endswith("@" + ALLOWED_DOMAIN))


def verify(token: str) -> Dict[str, Any]:
    return fb_auth.verify_id_token(token, app=_firebase(), clock_skew_seconds=10)


def require_auth(view: Callable) -> Callable:
    @wraps(view)
    def wrapper(*args, **kwargs):
        if AUTH_DISABLED:
            g.user = {"uid": "dev", "email": "dev@localhost", "name": "Desarrollo"}
            return view(*args, **kwargs)

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "unauthenticated"}), 401
        try:
            claims = verify(header[7:])
        except Exception:
            return jsonify({"error": "invalid_token"}), 401

        email = claims.get("email") or ""
        if not claims.get("email_verified") or not _allowed(email):
            return jsonify({"error": "forbidden"}), 403
        g.user = {"uid": claims["uid"], "email": email, "name": claims.get("name"), "picture": claims.get("picture")}
        return view(*args, **kwargs)

    return wrapper
