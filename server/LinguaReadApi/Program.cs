using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using System;
using System.Security.Claims;
using System.Text;
using LinguaReadApi.Data;
using LinguaReadApi.Services;
using Microsoft.Extensions.FileProviders; // Add this for StaticFileOptions
using System.IO; // Add this for Path.Combine
using Microsoft.AspNetCore.Http.Features; // Needed for FormOptions
using Microsoft.AspNetCore.Server.Kestrel.Core; // Needed for KestrelServerOptions
using DotNetEnv; // <-- Add this using directive
using LinguaReadApi.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity; // Keep one Identity using
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.ResponseCompression;
using System.IO.Compression;
// using Microsoft.AspNetCore.Identity.EntityFrameworkCore; // This namespace is not needed directly here

// --- Load .env file ---
Env.Load(); // <-- Load environment variables from .env file

var builder = WebApplication.CreateBuilder(args);

// --- Add Kestrel Configuration ---
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    // Keep a modest process-wide ceiling (30 MB, the framework default) so plain
    // JSON endpoints can't be used as a memory/DoS lever. The large-upload actions
    // (audiobooks, EPUBs, backup restore) opt in to higher limits per-endpoint via
    // [RequestSizeLimit], which overrides this global on a per-request basis.
    serverOptions.Limits.MaxRequestBodySize = 30L * 1024 * 1024; // 30 MB
});

// --- Add Form Options Configuration ---
builder.Services.Configure<FormOptions>(options =>
{
    // Modest global multipart ceiling to match Kestrel above. The upload actions
    // raise this per-endpoint via [RequestFormLimits(MultipartBodyLengthLimit = ...)],
    // which overrides this global, so big uploads keep working. Value/Key/Count limits
    // are left at framework defaults to keep the abuse surface small (the Texts batch
    // endpoints re-raise ValueLengthLimit in their own [RequestFormLimits] where needed).
    options.MultipartBodyLengthLimit = 30L * 1024 * 1024; // 30 MB
});

// --- Persist Data Protection keys ---
// Without this, ASP.NET Core stores keys in ~/.aspnet/DataProtection-Keys inside the
// container, which is lost whenever the container is rebuilt. That invalidates Identity
// token providers (password reset, email confirmation, 2FA) and any cookie/antiforgery
// payloads. Persist them to a mounted volume and pin the application name so keys remain
// valid across deployments.
//
// Default to a path relative to ContentRootPath so tests (which don't have /app writable)
// still work. In Docker, WORKDIR is /app so this resolves to /app/keys — matching the
// volume mount in docker-compose.yml.
if (!builder.Environment.IsEnvironment("Testing"))
{
    var dataProtectionKeysPath = Environment.GetEnvironmentVariable("DATA_PROTECTION_KEYS_PATH")
        ?? Path.Combine(builder.Environment.ContentRootPath, "keys");
    Directory.CreateDirectory(dataProtectionKeysPath);
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath))
        .SetApplicationName("LinguaReadApi");
}

// Add services to the container.
builder.Services.AddControllers();

// --- Response compression ---
// The reader payload (GET /api/texts/{id}: full content + every distinct word with
// translations) is the hottest response and is pure JSON. Compressing at the app rather
// than relying on nginx's on-the-fly gzip (a) preserves the strong ETags TextsController
// emits (nginx's gzip filter strips them, breaking PWA revalidation), (b) covers clients
// that talk to Kestrel directly (mobile builds, local dev), and (c) sends Brotli, which
// beats nginx's gzip level 6. nginx won't re-compress responses that already carry
// Content-Encoding. EnableForHttps is safe here: auth material lives in an httpOnly
// cookie, never in response bodies alongside reflected input (no BREACH surface).
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
// .NET 7+ maps Brotli Optimal to quality 4 — near-gzip CPU cost, better ratio.
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

// Process-wide cache, currently used for the language-config list that every
// translation request needs (see LanguageService).
builder.Services.AddMemoryCache();
// Configure DbContext with PostgreSQL
builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        npgsqlOptions =>
        {
            npgsqlOptions.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(30),
                errorCodesToAdd: null);
            npgsqlOptions.CommandTimeout(60);
        });

    // Sensitive EF Core logging should be Development-only.
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
    }
});

// --- Add ASP.NET Core Identity ---
// Make sure LinguaReadApi.Models.User exists and is the correct user class
builder.Services.AddIdentity<LinguaReadApi.Models.User, IdentityRole<Guid>>(options => // Specify Guid as the key type for IdentityRole
{
    // Configure identity options if needed (e.g., password requirements)
    options.SignIn.RequireConfirmedAccount = false; // Adjust as needed
    options.Password.RequireDigit = false;
    options.Password.RequiredLength = 6;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequireUppercase = false;
    options.Password.RequireLowercase = false;
})
.AddEntityFrameworkStores<AppDbContext>() // Tell Identity to use your DbContext
.AddDefaultTokenProviders(); // Adds providers for password reset tokens, etc.
 
// --- Remove the two duplicate AddIdentity blocks ---
// Register HttpClient
builder.Services.AddHttpClient();

// Discord weekly report configuration and services
builder.Services.Configure<DiscordReportOptions>(builder.Configuration.GetSection("Discord"));
builder.Services.AddScoped<DiscordReportService>();
builder.Services.AddHostedService<WeeklyDiscordReportHostedService>();

// Register word-level translation providers (DeepL default; Wiktionary, Azure Translator, and
// Google Translate optional) and the per-user factory that selects between them.
// NOTE: the provider services are intentionally Scoped. The factory applies per-user credentials
// by mutating the resolved instance (UseAccessToken/UseCredentials/UseApiKey); a Scoped lifetime
// gives one instance per request, so those secrets can't bleed across users. Do NOT make these
// Singleton without first removing that mutable per-request state.
builder.Services.AddScoped<ITranslationService, DeepLTranslationService>();
builder.Services.AddScoped<DeepLTranslationService>();
builder.Services.AddScoped<WiktionaryTranslationService>();
builder.Services.AddScoped<AzureTranslationService>();
builder.Services.AddScoped<GoogleTranslationService>();
builder.Services.AddScoped<IWordTranslationServiceFactory, WordTranslationServiceFactory>();

// Register Gemini Translation Service for sentences (concrete type for factory)
builder.Services.AddScoped<GeminiTranslationService>();
builder.Services.AddScoped<ISentenceTranslationService, GeminiTranslationService>();

// Register Gemini Story Generation Service (concrete type for factory)
builder.Services.AddScoped<GeminiStoryGenerationService>();
builder.Services.AddScoped<IStoryGenerationService, GeminiStoryGenerationService>();

// Register Gemini Summarization Service (concrete type for factory)
builder.Services.AddScoped<GeminiSummarizationService>();
builder.Services.AddScoped<ISummarizationService, GeminiSummarizationService>();

// Register OpenRouter Services
builder.Services.AddScoped<OpenRouterTranslationService>();
builder.Services.AddScoped<OpenRouterStoryGenerationService>();
builder.Services.AddScoped<OpenRouterSummarizationService>();

// Register Service Factories (select between Gemini/OpenRouter per-user)
builder.Services.AddScoped<ITranslationServiceFactory, TranslationServiceFactory>();
builder.Services.AddScoped<IStoryGenerationServiceFactory, StoryGenerationServiceFactory>();
builder.Services.AddScoped<ISummarizationServiceFactory, SummarizationServiceFactory>();

// Register Database Admin Service
builder.Services.AddScoped<IDatabaseAdminService, DatabaseAdminService>(); // <-- Add this line

// Word linking background processing
builder.Services.AddSingleton<WordLinkingChannel>();
builder.Services.AddHostedService<WordLinkingBackgroundService>();
// Signals StatsRecomputeService when the migration relink is done.
builder.Services.AddSingleton<MigrationSignal>();
// One-shot migration service: re-links any text below the current
// tokenizer version on startup (idempotent across restarts).
builder.Services.AddHostedService<WordLinkingMigrationService>();
// Nightly recompute of cached word stats (TotalWords/KnownWords/...)
// on Books and Texts. Drives the "% unknown" indicators in the UI.
// Registered as both a singleton (so an admin endpoint can trigger
// it on demand) and a hosted service (so the daily timer ticks).
builder.Services.AddSingleton<StatsRecomputeService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<StatsRecomputeService>());

// Register Language Service (New)
builder.Services.AddScoped<ILanguageService, LanguageService>();
builder.Services.AddScoped<IUserActivityService, UserActivityService>(); // Register UserActivityService
builder.Services.AddScoped<IGoalProgressService, GoalProgressService>();
builder.Services.AddScoped<IHardcoverService, HardcoverService>();
builder.Services.AddScoped<ChapterDetectionService>();

// Configure JWT Authentication
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = false;
    options.SaveToken = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("JWT Key is not configured"))
        )
    };
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var cookieToken = context.Request.Cookies[".LinguaRead.Auth"];
            if (!string.IsNullOrEmpty(cookieToken))
            {
                context.Token = cookieToken;
            }
            return Task.CompletedTask;
        }
    };
});

// Shared gate for destructive admin endpoints (see AdminOnlyPolicy.cs for the
// single-user default-allow rationale).
builder.Services.AddSingleton<IAuthorizationHandler, AdminOnlyHandler>();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AdminOnlyRequirement.PolicyName, policy => policy
        .RequireAuthenticatedUser()
        .AddRequirements(new AdminOnlyRequirement()));

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowClientApp", policy =>
    {
        // In production the app should be served behind the same-origin Nginx reverse proxy.
        // If you need cross-origin access (e.g., separate domain), set:
        // - Cors:AllowedOrigins (appsettings / env) or
        // - CORS_ALLOWED_ORIGINS (comma-separated)
        var configuredOrigins =
            builder.Configuration["Cors:AllowedOrigins"] ??
            Environment.GetEnvironmentVariable("CORS_ALLOWED_ORIGINS") ??
            string.Empty;

        var origins = configuredOrigins
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (builder.Environment.IsDevelopment())
        {
            policy.WithOrigins("http://localhost:3000", "http://localhost:19006", "http://localhost", "http://127.0.0.1:3000");
        }
        else if (origins.Length > 0)
        {
            policy.WithOrigins(origins);
        }
        else
        {
            // Default production stance: no cross-origin calls allowed.
            policy.SetIsOriginAllowed(_ => false);
        }

        policy.WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
              .WithHeaders("Content-Type", "Authorization", "Accept", "X-Requested-With")
              .AllowCredentials();
    });
});

var app = builder.Build();

// Static hook (not DI) because the EF value converter lives in the cached model,
// which outlives any single scoped context.
UserSettingsSecretProtector.Logger = app.Services
    .GetRequiredService<ILoggerFactory>()
    .CreateLogger(typeof(UserSettingsSecretProtector).FullName!);

// Trust reverse-proxy headers (Nginx) when deployed behind a proxy.
// NOTE: We clear known networks/proxies so this works in containerized environments.
var forwardedHeaderOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
};
forwardedHeaderOptions.KnownIPNetworks.Clear(); // .NET 10: KnownNetworks is obsolete, replaced by KnownIPNetworks
forwardedHeaderOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeaderOptions);

// Before anything that writes a response body (API JSON and static files alike).
app.UseResponseCompression();

// --- Add early exception logging middleware ---
app.Use(async (context, next) =>
{
    try
    {
        await next.Invoke();
    }
    catch (Exception ex)
    {
        // Log the exception details
        var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "Unhandled exception caught early in pipeline for request {Path}", context.Request.Path);

        // Optionally re-throw or handle the response
        // For now, just log and let the default error handling potentially take over
        // (or return a generic 500 if needed)
        if (!context.Response.HasStarted) // Avoid writing if response already started
        {
             context.Response.StatusCode = 500;
             await context.Response.WriteAsync("An unexpected server error occurred.");
        }
        // Do not re-throw if you handle the response here
    }
});
// --- End early exception logging middleware ---

// Apply Migrations and Seed the database
if (!app.Environment.IsEnvironment("Testing"))
{
    using (var scope = app.Services.CreateScope())
    {
        var services = scope.ServiceProvider;
        var logger = services.GetRequiredService<ILogger<Program>>(); // Get logger instance

        // --- Apply Migrations ---
        try
        {
            logger.LogInformation("Attempting to apply database migrations...");
            var dbContext = services.GetRequiredService<AppDbContext>();
            
            // Increase timeout for migrations - merging large word sets can take several minutes
            dbContext.Database.SetCommandTimeout(TimeSpan.FromMinutes(10));
            
            dbContext.Database.Migrate();
            logger.LogInformation("Database migrations applied successfully (or were already up-to-date).");
        }
        catch (Exception ex)
        {
            // Log the migration error AND stop the application if it fails.
            logger.LogError(ex, "An error occurred during database migration or table recovery. Halting application startup.");
            throw; // Re-throw the exception to stop the application
        }

        // --- Seed Custom Data (Languages, Default User) ---
        try
        {
            logger.LogInformation("Attempting to run DbInitializer...");
            DbInitializer.Initialize(services); // Run custom seeding logic
            logger.LogInformation("DbInitializer completed.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while running DbInitializer. Halting application startup.");
            throw;
        }

        // --- Encrypt UserSettings secrets left as plaintext at rest ---
        // The EncryptUserSettingsSecrets migration only widened the secret columns; it did not
        // rewrite existing values, and the transparent "encrypt on next save" only fires when a
        // secret's value actually changes. Without this pass, secrets stored before encryption was
        // introduced stay in cleartext. Idempotent and best-effort: a failure here must not stop
        // the app from starting (the columns still read correctly via the plaintext fallback).
        try
        {
            var dataProtectionProvider = services.GetService<IDataProtectionProvider>();
            if (dataProtectionProvider != null)
            {
                var dbOptions = services.GetRequiredService<DbContextOptions<AppDbContext>>();
                await UserSettingsSecretsReencryptor.EncryptLegacyPlaintextAsync(
                    dbOptions, dataProtectionProvider, logger);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to encrypt legacy plaintext user-settings secrets; continuing startup.");
        }
    }
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "LinguaRead API V1");
    });
}

// IMPORTANT: Order matters for middleware
// Apply CORS policy *very* early, before routing
app.UseCors("AllowClientApp");

app.UseRouting();

// Authentication runs before the static-file middlewares so the gate below can
// see context.User for requests to uploaded content.
app.UseAuthentication();

// User-uploaded content (audio lessons, audiobook tracks, EPUB images) lives under
// wwwroot with guessable paths (e.g. /audiobooks/{bookId}/track_1.mp3). Static-file
// middleware never consults authorization, so gate these prefixes explicitly: require
// authentication AND that the content belongs to the caller — otherwise any logged-in
// user could read another user's media by guessing the path. The web client requests
// them same-origin, so the httpOnly auth cookie is sent automatically.
string[] protectedStaticPrefixes = ["/audio_lessons", "/audiobooks", "/epub_assets"];

// audio_lessons/{userId}/file and epub_assets/{userId}/{bookId}/... embed the owner's user id in
// the path (free check); audiobooks/{bookId}/... key on an int book id and need a DB lookup.
static async Task<bool> CallerOwnsProtectedContentAsync(HttpContext context)
{
    if (!Guid.TryParse(context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
    {
        return false;
    }

    var path = context.Request.Path;

    if (path.StartsWithSegments("/audio_lessons", out var rest) ||
        path.StartsWithSegments("/epub_assets", out rest))
    {
        return Guid.TryParse(FirstSegment(rest), out var ownerId) && ownerId == userId;
    }

    if (path.StartsWithSegments("/audiobooks", out rest))
    {
        if (!int.TryParse(FirstSegment(rest), out var bookId))
        {
            return false;
        }
        var db = context.RequestServices.GetRequiredService<AppDbContext>();
        return await db.Books.AnyAsync(b => b.BookId == bookId && b.UserId == userId);
    }

    return false;

    static string? FirstSegment(PathString rest) =>
        rest.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries) is { Length: > 0 } parts
            ? parts[0]
            : null;
}

app.Use(async (context, next) =>
{
    if (protectedStaticPrefixes.Any(prefix => context.Request.Path.StartsWithSegments(prefix)))
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        if (!await CallerOwnsProtectedContentAsync(context))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
    }
    await next();
});

// Serve static files from wwwroot (e.g., uploaded audio)
// Use default UseStaticFiles for general wwwroot content
app.UseStaticFiles();

// Ensure the audio_lessons directory exists before configuring static files for it
var audioLessonsPath = Path.Combine(builder.Environment.ContentRootPath, "wwwroot", "audio_lessons");
Directory.CreateDirectory(audioLessonsPath); // Create if it doesn't exist

// Explicitly serve audio_lessons directory with a specific request path
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        audioLessonsPath), // Use the ensured path variable
    RequestPath = "/audio_lessons" // Map requests starting with /audio_lessons
});
// Ensure the base audiobooks directory exists before configuring static files for it
var audiobooksBasePath = Path.Combine(builder.Environment.ContentRootPath, "wwwroot", "audiobooks");
Directory.CreateDirectory(audiobooksBasePath); // This does nothing if the directory already exists

// Explicitly serve audiobooks directory
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(audiobooksBasePath), // Use the ensured path
    RequestPath = "/audiobooks" // Map requests starting with /audiobooks
});

// Apply CORS before authentication - Redundant comment, UseCors moved up
// app.UseCors("AllowClientApp"); // Moved up

// UseAuthentication moved above the static-file middlewares (uploaded-content gate).
app.UseAuthorization();

// Lightweight CSRF protection for cookie-based auth.
// Cross-origin forms cannot set custom headers, so requiring X-Requested-With
// on mutating requests prevents CSRF when using SameSite=Lax cookies.
app.Use(async (context, next) =>
{
    if (context.Request.Cookies.ContainsKey(".LinguaRead.Auth") &&
        !HttpMethods.IsGet(context.Request.Method) &&
        !HttpMethods.IsHead(context.Request.Method) &&
        !HttpMethods.IsOptions(context.Request.Method))
    {
        if (!context.Request.Headers.ContainsKey("X-Requested-With"))
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsync("Missing CSRF header");
            return;
        }
    }
    await next();
});

app.MapControllers();

// Configure Kestrel to use port 5000.
// Wrapped in try/catch so design-time tooling that runs the assembly without
// a live server (e.g. Swashbuckle.AspNetCore.Cli's `dotnet swagger tofile`,
// used to generate TypeScript types for the frontend) doesn't crash on the
// missing IServerAddressesFeature. Production behavior is unchanged.
try
{
    app.Urls.Clear();
    app.Urls.Add("http://0.0.0.0:5000");
}
catch (InvalidOperationException)
{
    // No IServerAddressesFeature available — running under design-time tooling.
}

app.Run();

public partial class Program { }