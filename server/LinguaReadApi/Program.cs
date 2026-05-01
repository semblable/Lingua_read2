using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using System;
using System.Text;
using LinguaReadApi.Data;
using Microsoft.OpenApi.Models;
using LinguaReadApi.Services;
using Microsoft.Extensions.FileProviders; // Add this for StaticFileOptions
using System.IO; // Add this for Path.Combine
using Microsoft.AspNetCore.Http.Features; // Needed for FormOptions
using Microsoft.AspNetCore.Server.Kestrel.Core; // Needed for KestrelServerOptions
using DotNetEnv; // <-- Add this using directive
using Microsoft.AspNetCore.Identity; // Keep one Identity using
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.DataProtection;
// using Microsoft.AspNetCore.Identity.EntityFrameworkCore; // This namespace is not needed directly here

// --- Load .env file ---
Env.Load(); // <-- Load environment variables from .env file

var builder = WebApplication.CreateBuilder(args);

// --- Add Kestrel Configuration ---
builder.WebHost.ConfigureKestrel(serverOptions =>
{
    // Set a higher limit for the request body size to support large audiobooks
    // Adjusted to 5 GB to allow uploading complete audiobooks
    serverOptions.Limits.MaxRequestBodySize = 5120L * 1024 * 1024; // 5 GB (5120 MB)
});

// --- Add Form Options Configuration ---
builder.Services.Configure<FormOptions>(options =>
{
    // Ensure this limit is also high enough for multipart requests (5 GB to match Kestrel)
    options.MultipartBodyLengthLimit = 5120L * 1024 * 1024; // 5 GB (5120 MB)
    // You might need to adjust other limits depending on your form data
    options.ValueLengthLimit = int.MaxValue; // Or a specific large value
    options.KeyLengthLimit = int.MaxValue;   // Or a specific large value
    options.ValueCountLimit = int.MaxValue; // Or a specific large value
    // options.MemoryBufferThreshold = int.MaxValue; // REMOVED - Use default disk buffering for large files
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

// Register DeepL Translation Service
builder.Services.AddScoped<ITranslationService, DeepLTranslationService>();

// Register Gemini Translation Service for sentences (concrete type for factory)
builder.Services.AddScoped<GeminiTranslationService>();
builder.Services.AddScoped<ISentenceTranslationService, GeminiTranslationService>();

// Register Gemini Story Generation Service (concrete type for factory)
builder.Services.AddScoped<GeminiStoryGenerationService>();
builder.Services.AddScoped<IStoryGenerationService, GeminiStoryGenerationService>();

// Register OpenRouter Services
builder.Services.AddScoped<OpenRouterTranslationService>();
builder.Services.AddScoped<OpenRouterStoryGenerationService>();

// Register Service Factories (select between Gemini/OpenRouter per-user)
builder.Services.AddScoped<ITranslationServiceFactory, TranslationServiceFactory>();
builder.Services.AddScoped<IStoryGenerationServiceFactory, StoryGenerationServiceFactory>();

// Register Database Admin Service
builder.Services.AddScoped<IDatabaseAdminService, DatabaseAdminService>(); // <-- Add this line

// Word linking background processing
builder.Services.AddSingleton<WordLinkingChannel>();
builder.Services.AddHostedService<WordLinkingBackgroundService>();

// Register Language Service (New)
builder.Services.AddScoped<ILanguageService, LanguageService>();
builder.Services.AddScoped<IUserActivityService, UserActivityService>(); // Register UserActivityService
builder.Services.AddScoped<IGoalProgressService, GoalProgressService>();
builder.Services.AddScoped<IHardcoverService, HardcoverService>();

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

// Trust reverse-proxy headers (Nginx) when deployed behind a proxy.
// NOTE: We clear known networks/proxies so this works in containerized environments.
var forwardedHeaderOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
};
forwardedHeaderOptions.KnownNetworks.Clear();
forwardedHeaderOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeaderOptions);

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

app.UseAuthentication();
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

// Configure Kestrel to use port 5000
app.Urls.Clear();
app.Urls.Add("http://0.0.0.0:5000");

app.Run();

public partial class Program { }