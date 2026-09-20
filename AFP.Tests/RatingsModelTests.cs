using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using AFP.Pages;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AFP.Tests;

public class RatingsModelTests
{
    // ── Test doubles ──────────────────────────────────────────────────
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }
        public string?             LastBody    { get; private set; }
        public HttpStatusCode      Status      { get; set; } = HttpStatusCode.OK;
        public string              ResponseJson { get; set; } = "{}";

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            if (request.Content is not null)
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(Status)
            {
                Content = new StringContent(ResponseJson, Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed class SingleClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public SingleClientFactory(HttpMessageHandler h) => _handler = h;
        public HttpClient CreateClient(string name)
            => new(_handler, disposeHandler: false) { BaseAddress = new Uri("http://backend.local") };
    }

    private static (RatingsModel model, CapturingHandler handler) NewModel()
    {
        var h = new CapturingHandler();
        return (new RatingsModel(new SingleClientFactory(h), NullLogger<RatingsModel>.Instance), h);
    }

    private static T Get<T>(object obj, string prop)
    {
        var p = obj.GetType().GetProperty(prop)
                ?? throw new InvalidOperationException($"Property '{prop}' not found.");
        return (T)p.GetValue(obj)!;
    }

    // ── Validation ────────────────────────────────────────────────────
    [Theory]
    [InlineData(0, 3)]
    [InlineData(-1, 3)]
    public async Task PostShop_InvalidTargetId_Returns400(int targetId, int stars)
    {
        var (model, _) = NewModel();
        var result = await model.OnPostShopAsync(new RatingRequest { TargetId = targetId, Stars = stars });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(-2)]
    public async Task PostShop_InvalidStars_Returns400(int stars)
    {
        var (model, _) = NewModel();
        var result = await model.OnPostShopAsync(new RatingRequest { TargetId = 1, Stars = stars });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── Shop upsert forwards to backend ───────────────────────────────
    [Fact]
    public async Task PostShop_ValidRequest_ForwardsToBackend()
    {
        var (model, handler) = NewModel();
        handler.ResponseJson = "{\"ok\":true}";

        var result = await model.OnPostShopAsync(new RatingRequest
        {
            TargetId = 42, Stars = 5, Comment = "Great service",
        });

        Assert.IsType<JsonResult>(result);
        Assert.NotNull(handler.LastRequest);
        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.EndsWith("/api/shop-ratings", handler.LastRequest.RequestUri!.AbsolutePath);

        using var doc = JsonDocument.Parse(handler.LastBody!);
        var root = doc.RootElement;
        Assert.Equal(42, root.GetProperty("shopId").GetInt32());
        Assert.Equal(5,  root.GetProperty("stars").GetInt32());
        Assert.Equal("Great service", root.GetProperty("comment").GetString());
    }

    [Fact]
    public async Task PostDoctor_ValidRequest_ForwardsToDoctorEndpoint()
    {
        var (model, handler) = NewModel();
        handler.ResponseJson = "{\"ok\":true}";

        await model.OnPostDoctorAsync(new RatingRequest { TargetId = 7, Stars = 4, Comment = "OK" });

        Assert.EndsWith("/api/doctor-ratings", handler.LastRequest!.RequestUri!.AbsolutePath);
        using var doc = JsonDocument.Parse(handler.LastBody!);
        Assert.Equal(7, doc.RootElement.GetProperty("doctorId").GetInt32());
    }

    [Fact]
    public async Task PostShop_TrimsAndClampsLongComment()
    {
        var (model, handler) = NewModel();
        handler.ResponseJson = "{\"ok\":true}";
        var longComment = new string('a', RatingsModel.MaxCommentLength + 50);

        await model.OnPostShopAsync(new RatingRequest { TargetId = 1, Stars = 3, Comment = longComment });

        using var doc = JsonDocument.Parse(handler.LastBody!);
        Assert.Equal(RatingsModel.MaxCommentLength,
                     doc.RootElement.GetProperty("comment").GetString()!.Length);
    }

    [Fact]
    public async Task PostShop_BackendError_ReturnsBackendStatus()
    {
        var (model, handler) = NewModel();
        handler.Status = HttpStatusCode.InternalServerError;
        handler.ResponseJson = "{\"error\":\"boom\"}";

        var result = await model.OnPostShopAsync(new RatingRequest { TargetId = 1, Stars = 3 });
        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, status.StatusCode);
    }

    // ── Summary ───────────────────────────────────────────────────────
    [Fact]
    public async Task GetShopSummary_ReturnsBackendPayload()
    {
        var (model, handler) = NewModel();
        handler.ResponseJson = "{\"average\":4.5,\"count\":10,\"myRating\":5}";

        var result = await model.OnGetShopSummaryAsync(42);

        Assert.IsType<JsonResult>(result);
        Assert.EndsWith("/api/shop-ratings/42/summary", handler.LastRequest!.RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task GetDoctorSummary_NotFound_ReturnsZeroSummary()
    {
        var (model, handler) = NewModel();
        handler.Status = HttpStatusCode.NotFound;

        var result = (JsonResult)await model.OnGetDoctorSummaryAsync(999);
        Assert.Equal(0.0, Get<double>(result.Value!, "average"));
        Assert.Equal(0,   Get<int>(result.Value!, "count"));
    }

    [Fact]
    public async Task GetShopSummary_InvalidId_Returns400()
    {
        var (model, _) = NewModel();
        var result = await model.OnGetShopSummaryAsync(0);
        Assert.IsType<BadRequestObjectResult>(result);
    }
}
