import sqlalchemy
import sqlalchemy.orm

DATABASE_URL = "sqlite:///./zyqra.db"

engine: sqlalchemy.Engine = sqlalchemy.create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session] = sqlalchemy.orm.sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = sqlalchemy.orm.declarative_base()