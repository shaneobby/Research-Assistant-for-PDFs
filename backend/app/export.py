"""Render a paper's summary as a Markdown document (download / share / paste into notes)."""


def _pages(sp: dict, key: str) -> str:
    pages = sp.get(key) or []
    return f" *(pp. {', '.join(map(str, pages))})*" if pages else ""


def summary_markdown(paper: dict) -> str:
    s = paper["summary"]
    sp = s.get("source_pages") or {}
    out = [f"# {s['title']}", ""]
    if s.get("authors"):
        out += [f"**Authors:** {', '.join(s['authors'])}", ""]
    if s.get("keywords"):
        out += [f"**Keywords:** {', '.join(s['keywords'])}", ""]
    out += [f"_Source: {paper['filename']} ({paper['pages']} pages)_", ""]
    if s.get("abstract"):
        out += ["## Abstract", "", s["abstract"], ""]
    out += ["## Problem statement" + _pages(sp, "problem_statement"), "", s["problem_statement"], ""]
    out += ["## Methodology" + _pages(sp, "methodology"), "", s["methodology"], ""]
    out += ["## Key results" + _pages(sp, "key_results"), ""] + [f"- {r}" for r in s["key_results"]] + [""]
    out += ["## Conclusion" + _pages(sp, "conclusion"), "", s["conclusion"], ""]
    if s.get("suggested_questions"):
        out += ["## Questions to explore", ""] + [f"- {q}" for q in s["suggested_questions"]] + [""]
    return "\n".join(out)
