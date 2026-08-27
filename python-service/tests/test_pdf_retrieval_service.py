"""Tests for the open-access PDF retrieval service."""

import httpx
import pytest

from src.services.pdf_retrieval_service import (
    PdfCandidate,
    PdfQuery,
    PdfRetrievalService,
    describe_failure,
    extract_arxiv_id,
    order_candidates,
    titles_match,
)

PDF_BYTES = b"%PDF-1.7\nfake pdf body\n%%EOF"
LANDING_HTML = (
    b'<html><head><meta name="citation_pdf_url" '
    b'content="https://example.org/paper.pdf"></head><body>Landing</body></html>'
)


def make_service(handler) -> tuple[PdfRetrievalService, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return PdfRetrievalService(client), client


def json_response(payload: dict) -> httpx.Response:
    return httpx.Response(200, json=payload)


# ------------------------------------------------------------------ helpers


def test_extract_arxiv_id_from_doi():
    assert extract_arxiv_id("10.48550/arXiv.2301.04567") == "2301.04567"


def test_extract_arxiv_id_from_url():
    assert extract_arxiv_id(None, "https://arxiv.org/abs/2301.04567v2") == "2301.04567v2"


def test_extract_arxiv_id_old_style():
    assert extract_arxiv_id("https://arxiv.org/abs/cs/0112017") == "cs/0112017"


def test_extract_arxiv_id_returns_none_for_plain_doi():
    assert extract_arxiv_id("10.1145/3597503.3623301") is None


def test_titles_match_ignores_punctuation_and_case():
    assert titles_match(
        "Cooperative Awareness in CAVs: A Survey",
        "cooperative awareness in cavs - a survey",
    )


def test_titles_match_rejects_different_papers():
    assert not titles_match("A Survey of Platooning", "Reinforcement Learning for Traffic Lights")


def test_clean_doi_strips_url_prefix():
    assert PdfQuery(doi="https://doi.org/10.1145/ABC").clean_doi == "10.1145/abc"


# ------------------------------------------------------------------ resolvers


@pytest.mark.asyncio
async def test_arxiv_id_shortcut_downloads_without_api_calls():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "arxiv.org/pdf" in str(request.url):
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.48550/arXiv.2301.04567", title="Paper"))

    assert result.found is True
    assert result.provider == "arxiv"
    assert result.content == PDF_BYTES
    # Only the arXiv PDF was requested — no Unpaywall/OpenAlex round trips.
    assert calls == ["https://arxiv.org/pdf/2301.04567"]


@pytest.mark.asyncio
async def test_unpaywall_best_location_is_used(monkeypatch):
    monkeypatch.setattr(
        "src.services.pdf_retrieval_service.settings.oa_contact_email", "test@example.org"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.unpaywall.org" in url:
            assert "email=test%40example.org" in url
            return json_response(
                {
                    "best_oa_location": {
                        "url_for_pdf": "https://repo.example.org/oa.pdf",
                        "license": "cc-by",
                        "version": "publishedVersion",
                    }
                }
            )
        if url == "https://repo.example.org/oa.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1145/3597503", title="Paper"))

    assert result.found is True
    assert result.provider == "unpaywall"
    assert result.license == "cc-by"
    assert result.source_url == "https://repo.example.org/oa.pdf"


@pytest.mark.asyncio
async def test_unpaywall_skipped_without_contact_email(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        await service.retrieve(PdfQuery(doi="10.1145/3597503"))

    assert "api.unpaywall.org" not in seen


@pytest.mark.asyncio
async def test_openalex_falls_back_to_title_search(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.openalex.org/works?" in url:
            return json_response(
                {
                    "results": [
                        {"title": "A completely different paper", "best_oa_location": None},
                        {
                            "title": "Cooperative Perception for CAVs",
                            "best_oa_location": {
                                "pdf_url": "https://oa.example.org/cav.pdf",
                                "license": "cc-by-sa",
                            },
                        },
                    ]
                }
            )
        if url == "https://oa.example.org/cav.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(title="Cooperative Perception for CAVs"))

    assert result.found is True
    assert result.provider == "openalex"


@pytest.mark.asyncio
async def test_title_search_ignores_mismatched_results(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.openalex.org/works?" in url:
            return json_response(
                {
                    "results": [
                        {
                            "title": "An unrelated study on compilers",
                            "best_oa_location": {"pdf_url": "https://oa.example.org/wrong.pdf"},
                        }
                    ]
                }
            )
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(title="Cooperative Perception for CAVs"))

    assert result.found is False
    assert "https://oa.example.org/wrong.pdf" not in [c.url for c in result.candidates]


@pytest.mark.asyncio
async def test_semantic_scholar_open_access_pdf(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.semanticscholar.org" in url:
            return json_response(
                {"title": "Paper", "openAccessPdf": {"url": "https://s2.example.org/p.pdf"}}
            )
        if url == "https://s2.example.org/p.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1145/3597503", title="Paper"))

    assert result.found is True
    assert result.provider == "semantic-scholar"


# ------------------------------------------------------------------ download


@pytest.mark.asyncio
async def test_download_follows_citation_pdf_url_on_html_landing_page():
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "https://example.org/landing":
            return httpx.Response(200, content=LANDING_HTML)
        if str(request.url) == "https://example.org/paper.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        downloaded = await service.download_pdf("https://example.org/landing")

    assert downloaded is not None
    assert downloaded.content == PDF_BYTES
    # Provenance points at the file, not the landing page we came in through
    assert downloaded.url == "https://example.org/paper.pdf"


@pytest.mark.asyncio
async def test_download_rejects_html_without_pdf_link():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html><body>Paywall</body></html>")

    service, client = make_service(handler)
    async with client:
        assert await service.download_pdf("https://example.org/paywalled") is None


@pytest.mark.asyncio
async def test_download_enforces_size_limit(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.pdf_retrieval_max_mb", 1)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=PDF_BYTES + b"x" * (2 * 1024 * 1024))

    service, client = make_service(handler)
    async with client:
        assert await service.download_pdf("https://example.org/huge.pdf") is None


@pytest.mark.asyncio
async def test_download_returns_none_on_network_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    service, client = make_service(handler)
    async with client:
        assert await service.download_pdf("https://example.org/p.pdf") is None


@pytest.mark.asyncio
async def test_failing_provider_does_not_abort_the_chain(monkeypatch):
    monkeypatch.setattr(
        "src.services.pdf_retrieval_service.settings.oa_contact_email", "test@example.org"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.unpaywall.org" in url:
            raise httpx.ConnectError("unpaywall down", request=request)
        if "api.openalex.org" in url:
            return json_response({"open_access": {"oa_url": "https://oa.example.org/fallback.pdf"}})
        if url == "https://oa.example.org/fallback.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1145/3597503", title="Paper"))

    assert result.found is True
    assert result.provider == "openalex"
    assert "unpaywall" in result.providers_tried


@pytest.mark.asyncio
async def test_no_metadata_yields_not_found(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"unexpected request to {request.url}")

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery())

    assert result.found is False
    assert result.reason.startswith("No open-access copy found")


# ------------------------------------------------- candidate ranking & reporting


def test_repository_copies_are_tried_before_publisher_copies():
    publisher = PdfCandidate(url="https://www.mdpi.com/x/pdf", provider="openalex")
    repo_landing = PdfCandidate(
        url="https://research.chalmers.se/publication/1",
        provider="openalex",
        kind="landing",
        is_repository=True,
    )
    repo_pdf = PdfCandidate(
        url="https://research.chalmers.se/file/1.pdf", provider="openalex", is_repository=True
    )

    assert order_candidates([publisher, repo_landing, repo_pdf]) == [
        repo_pdf,
        repo_landing,
        publisher,
    ]


def test_describe_failure_reports_a_blocked_open_access_copy():
    reason = describe_failure([PdfCandidate(url="https://www.mdpi.com/x/pdf", provider="openalex")])

    assert "www.mdpi.com" in reason
    assert "refused the download" in reason


def test_describe_failure_ignores_the_speculative_landing_probe():
    """A Scopus record page is not an open-access link and must not be reported as one."""
    probe = PdfCandidate(
        url="https://www.scopus.com/pages/publications/1",
        provider="landing-page",
        kind="landing",
        is_open_access=False,
    )

    assert describe_failure([probe]).startswith("No open-access copy found")


@pytest.mark.asyncio
async def test_openalex_repository_landing_page_is_used_when_the_publisher_blocks(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.openalex.org" in url:
            return json_response(
                {
                    "locations": [
                        {
                            "is_oa": True,
                            "pdf_url": "https://www.mdpi.com/1/pdf",
                            "landing_page_url": "https://doi.org/10.3390/x",
                            "source": {"type": "journal"},
                        },
                        {
                            "is_oa": True,
                            "pdf_url": None,
                            "landing_page_url": "https://research.chalmers.se/publication/1",
                            "source": {"type": "repository"},
                        },
                    ]
                }
            )
        if url == "https://research.chalmers.se/publication/1":
            return httpx.Response(200, content=LANDING_HTML)
        if url == "https://example.org/paper.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        # The publisher answers automated requests with 403, as MDPI/Elsevier do.
        return httpx.Response(403, content=b"<html>blocked</html>")

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.3390/x"))

    assert result.found is True
    assert result.source_url == "https://example.org/paper.pdf"


@pytest.mark.asyncio
async def test_unpaywall_repository_landing_page_is_a_candidate(monkeypatch):
    monkeypatch.setattr(
        "src.services.pdf_retrieval_service.settings.oa_contact_email", "test@example.org"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.unpaywall.org" in url:
            return json_response(
                {
                    "best_oa_location": {
                        "url_for_pdf": None,
                        "url_for_landing_page": "https://repo.example.org/item/1",
                        "host_type": "repository",
                    }
                }
            )
        if url == "https://repo.example.org/item/1":
            return httpx.Response(200, content=LANDING_HTML)
        if url == "https://example.org/paper.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1145/1"))

    assert result.found is True
    assert result.provider == "unpaywall"


@pytest.mark.asyncio
async def test_index_landing_pages_are_never_probed(monkeypatch):
    """Scopus record pages redirect through an Elsevier login and never serve a PDF."""
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(
            PdfQuery(doi="10.1109/x", url="https://www.scopus.com/pages/publications/85065493613")
        )

    assert not any("scopus.com" in url for url in requested)
    assert result.reason.startswith("No open-access copy found")


@pytest.mark.asyncio
async def test_resolve_candidates_deduplicates_repeated_locations(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        if "api.openalex.org" in str(request.url):
            location = {
                "is_oa": True,
                "pdf_url": "https://www.mdpi.com/1/pdf",
                "source": {"type": "journal"},
            }
            return json_response(
                {
                    "best_oa_location": location,
                    "primary_location": location,
                    "locations": [location, location],
                }
            )
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        candidates, _ = await service.resolve_candidates(PdfQuery(doi="10.3390/x"))

    assert [c.url for c in candidates] == ["https://www.mdpi.com/1/pdf"]


@pytest.mark.asyncio
async def test_semantic_scholar_retries_once_after_a_429(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    monkeypatch.setattr("src.services.pdf_retrieval_service.SEMANTIC_SCHOLAR_BACKOFF_SECONDS", 0)
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.semanticscholar.org" in url:
            attempts.append(url)
            if len(attempts) == 1:
                return httpx.Response(429)
            return json_response(
                {"title": "Paper", "openAccessPdf": {"url": "https://s2.example.org/p.pdf"}}
            )
        if url == "https://s2.example.org/p.pdf":
            return httpx.Response(200, content=PDF_BYTES)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1145/1", title="Paper"))

    assert len(attempts) == 2
    assert result.found is True
    assert result.provider == "semantic-scholar"


@pytest.mark.asyncio
async def test_index_hosts_listed_by_openalex_are_dropped(monkeypatch):
    """OpenAlex marks some Scopus record URLs as open-access locations; they are not."""
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        requested.append(url)
        if "api.openalex.org" in url:
            return json_response(
                {
                    "locations": [
                        {
                            "is_oa": True,
                            "landing_page_url": "http://www.scopus.com/inward/record.url?scp=1",
                            "source": {"type": "repository"},
                        }
                    ]
                }
            )
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.1109/x"))

    assert not any("scopus.com" in url for url in requested)
    assert result.open_access_urls() == []
    assert result.reason.startswith("No open-access copy found")


@pytest.mark.asyncio
async def test_blocked_open_access_links_are_reported_for_manual_download(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")

    def handler(request: httpx.Request) -> httpx.Response:
        if "api.openalex.org" in str(request.url):
            return json_response(
                {
                    "locations": [
                        {
                            "is_oa": True,
                            "pdf_url": "https://www.mdpi.com/1/pdf",
                            "source": {"type": "journal"},
                        }
                    ]
                }
            )
        return httpx.Response(403, content=b"<html>bot wall</html>")

    service, client = make_service(handler)
    async with client:
        result = await service.retrieve(PdfQuery(doi="10.3390/x"))

    assert result.found is False
    assert result.open_access_urls() == ["https://www.mdpi.com/1/pdf"]


@pytest.mark.asyncio
async def test_semantic_scholar_api_key_is_sent_when_configured(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    monkeypatch.setattr(
        "src.services.pdf_retrieval_service.settings.semantic_scholar_api_key", "secret-key"
    )
    keys: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "api.semanticscholar.org" in url:
            keys.append(request.headers.get("x-api-key"))
            return json_response({"title": "Paper", "openAccessPdf": None})
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        await service.retrieve(PdfQuery(doi="10.1145/1", title="Paper"))

    assert keys and all(key == "secret-key" for key in keys)


@pytest.mark.asyncio
async def test_no_api_key_header_without_configuration(monkeypatch):
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.oa_contact_email", "")
    monkeypatch.setattr("src.services.pdf_retrieval_service.settings.semantic_scholar_api_key", "")
    seen: list[bool] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "api.semanticscholar.org" in str(request.url):
            seen.append("x-api-key" in request.headers)
        return httpx.Response(404)

    service, client = make_service(handler)
    async with client:
        await service.retrieve(PdfQuery(doi="10.1145/1", title="Paper"))

    assert seen and not any(seen)
