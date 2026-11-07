from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SourcePages(BaseModel):
    problem_statement: list[int] = Field(default_factory=list)
    methodology: list[int] = Field(default_factory=list)
    key_results: list[int] = Field(default_factory=list)
    conclusion: list[int] = Field(default_factory=list)


class Summary(BaseModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    abstract: str = ""
    problem_statement: str
    methodology: str
    key_results: list[str]
    conclusion: str
    keywords: list[str] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    source_pages: SourcePages = Field(default_factory=SourcePages)


class Paper(BaseModel):
    id: str
    filename: str
    pages: int
    created_at: datetime
    status: Literal["processing", "ready", "error"]
    error: str | None = None
    summary: Summary | None = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)


class Health(BaseModel):
    status: str
    llm_provider: str
    model: str
