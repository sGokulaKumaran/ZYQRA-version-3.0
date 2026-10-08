from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str):
    password = password[:72]  # ✅ FIX LIMIT
    return pwd_context.hash(password)

def verify_password(plain, hashed):
    return pwd_context.verify(plain[:72], hashed)