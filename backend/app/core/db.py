from fastapi import Request
from sqlalchemy import Engine
from sqlmodel import Session, create_engine


def make_engine(database_url: str) -> Engine:
    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(database_url, connect_args=connect_args)


def get_db(request: Request):
    with Session(request.app.state.engine) as session:
        yield session
