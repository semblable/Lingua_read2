using Microsoft.EntityFrameworkCore;
using LinguaReadApi.Models;

namespace LinguaReadApi.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }
        
        public DbSet<User> Users { get; set; }
        public DbSet<Language> Languages { get; set; }
        public DbSet<Text> Texts { get; set; }
        public DbSet<Word> Words { get; set; }
        public DbSet<WordTranslation> WordTranslations { get; set; }
        public DbSet<TextWord> TextWords { get; set; }
        public DbSet<Book> Books { get; set; }
        public DbSet<UserActivity> UserActivities { get; set; }
        public DbSet<UserSettings> UserSettings { get; set; }
        public DbSet<Tag> Tags { get; set; }
        public DbSet<BookTag> BookTags { get; set; }
        public DbSet<AudiobookTrack> AudiobookTracks { get; set; } // Added for Audiobook feature
        public DbSet<UserBookProgress> UserBookProgresses { get; set; } // Added for per-book audiobook progress
        public DbSet<LanguageDictionary> LanguageDictionaries { get; set; } // Added for Language Config feature
        public DbSet<LanguageSentenceSplitException> LanguageSentenceSplitExceptions { get; set; } // Added for Language Config feature
        public DbSet<UserLanguageStatistics> UserLanguageStatistics { get; set; } // Added for aggregated stats
        public DbSet<UserAudioLessonProgress> UserAudioLessonProgresses { get; set; } // Added for audio lesson progress
        public DbSet<UserSentenceProgress> UserSentenceProgresses { get; set; }
        public DbSet<SrsCardReview> SrsCardReviews { get; set; }
        public DbSet<SrsPhrase> SrsPhrases { get; set; }
        public DbSet<SrsReviewLog> SrsReviewLogs { get; set; }
        public DbSet<Folder> Folders { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            
            // Configure relationships
            
            // User - Text: One-to-Many
            modelBuilder.Entity<Text>()
                .HasOne(t => t.User)
                .WithMany(u => u.Texts)
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
                
            // Language - Text: One-to-Many
            modelBuilder.Entity<Text>()
                .HasOne(t => t.Language)
                .WithMany(l => l.Texts)
                .HasForeignKey(t => t.LanguageId)
                .OnDelete(DeleteBehavior.Restrict);
            
            // Book - Text: One-to-Many
            modelBuilder.Entity<Text>()
                .HasOne(t => t.Book)
                .WithMany(b => b.Texts)
                .HasForeignKey(t => t.BookId)
                .OnDelete(DeleteBehavior.Cascade) // Changed from Restrict to Cascade
                .IsRequired(false);
            
            // User - Book: One-to-Many
            modelBuilder.Entity<Book>()
                .HasOne(b => b.User)
                .WithMany(u => u.Books)
                .HasForeignKey(b => b.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            
            // Language - Book: One-to-Many
            modelBuilder.Entity<Book>()
                .HasOne(b => b.Language)
                .WithMany(l => l.Books) // Correct: Specify the inverse navigation property
                .HasForeignKey(b => b.LanguageId)
                .OnDelete(DeleteBehavior.Restrict);
                
            // Word - Language: Many-to-One
            modelBuilder.Entity<Word>()
                .HasOne(w => w.Language)
                .WithMany(l => l.Words)
                .HasForeignKey(w => w.LanguageId)
                .OnDelete(DeleteBehavior.Restrict);
                
            // Word - User: Many-to-One
            modelBuilder.Entity<Word>()
                .HasOne(w => w.User)
                .WithMany(u => u.Words)
                .HasForeignKey(w => w.UserId)
                .OnDelete(DeleteBehavior.Cascade);
                
            // Word - WordTranslation: One-to-One
            modelBuilder.Entity<Word>()
                .HasOne(w => w.Translation)
                .WithOne(wt => wt.Word)
                .HasForeignKey<WordTranslation>(wt => wt.WordId)
                .OnDelete(DeleteBehavior.Cascade);
                
            // Text - Word: Many-to-Many through TextWord
            modelBuilder.Entity<TextWord>()
                .HasKey(tw => tw.TextWordId);

            modelBuilder.Entity<TextWord>()
                .HasIndex(tw => new { tw.TextId, tw.WordId })
                .IsUnique();
                
            modelBuilder.Entity<TextWord>()
                .HasOne(tw => tw.Text)
                .WithMany(t => t.TextWords)
                .HasForeignKey(tw => tw.TextId)
                .OnDelete(DeleteBehavior.Cascade);
                
            modelBuilder.Entity<TextWord>()
                .HasOne(tw => tw.Word)
                .WithMany(w => w.TextWords)
                .HasForeignKey(tw => tw.WordId)
                .OnDelete(DeleteBehavior.Restrict);
                
            // Configure Book.LastReadText relationship
            modelBuilder.Entity<Book>()
                .HasOne(b => b.LastReadText)
                .WithMany()
                .HasForeignKey(b => b.LastReadTextId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull);
                
            // Configure unique constraints
            modelBuilder.Entity<User>()
                .HasIndex(u => u.Email)
                .IsUnique();

            modelBuilder.Entity<Language>()
                .HasIndex(l => l.Name)
                .IsUnique();

            modelBuilder.Entity<Language>()
                .HasIndex(l => l.Code)
                .IsUnique();
            
            // UserActivity - Language: Many-to-One
            modelBuilder.Entity<UserActivity>()
                .HasOne(ua => ua.Language)
                .WithMany()
                .HasForeignKey(ua => ua.LanguageId)
                .OnDelete(DeleteBehavior.Restrict);
                
            // User - UserSettings: One-to-One
            modelBuilder.Entity<UserSettings>()
                .HasOne(us => us.User)
                .WithOne(u => u.Settings)
                .HasForeignKey<UserSettings>(us => us.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure Tag entity
            modelBuilder.Entity<Tag>()
                .HasIndex(t => t.Name)
                .IsUnique();

            // Configure unique index for Words to speed up lookups and prevent duplicates
            modelBuilder.Entity<Word>()
                .HasIndex(w => new { w.UserId, w.LanguageId, w.Term })
                .IsUnique();

            // Configure BookTag join entity (Many-to-Many: Book <-> Tag)
            modelBuilder.Entity<BookTag>()
                .HasKey(bt => new { bt.BookId, bt.TagId }); // Composite primary key

            modelBuilder.Entity<BookTag>()
                .HasOne(bt => bt.Book)
                .WithMany(b => b.BookTags) // Navigation property in Book
                .HasForeignKey(bt => bt.BookId)
                .OnDelete(DeleteBehavior.Cascade); // If a book is deleted, remove its tag associations

            modelBuilder.Entity<BookTag>()
                .HasOne(bt => bt.Tag)
                .WithMany(t => t.BookTags) // Navigation property in Tag
                .HasForeignKey(bt => bt.TagId)
                .OnDelete(DeleteBehavior.Cascade); // If a tag is deleted, remove its associations with books

            // Configure UserBookProgress entity
            modelBuilder.Entity<UserBookProgress>()
                .HasKey(ubp => new { ubp.UserId, ubp.BookId }); // Composite primary key

            modelBuilder.Entity<UserBookProgress>()
                .HasOne(ubp => ubp.User)
                .WithMany() // No collection navigation property in User for this
                .HasForeignKey(ubp => ubp.UserId)
                .OnDelete(DeleteBehavior.Cascade); // If user is deleted, delete their progress

            modelBuilder.Entity<UserBookProgress>()
                .HasOne(ubp => ubp.Book)
                .WithMany() // No collection navigation property in Book for this
                .HasForeignKey(ubp => ubp.BookId)
                .OnDelete(DeleteBehavior.Cascade); // If book is deleted, delete its progress records

            modelBuilder.Entity<UserBookProgress>()
                .HasOne(ubp => ubp.CurrentAudiobookTrack)
                .WithMany() // No collection navigation property in AudiobookTrack for this
                .HasForeignKey(ubp => ubp.CurrentAudiobookTrackId)
                .IsRequired(false) // TrackId can be null
                .OnDelete(DeleteBehavior.SetNull); // If track is deleted, set FK to null

            // Configure Language -> LanguageDictionary: One-to-Many
            modelBuilder.Entity<LanguageDictionary>()
                .HasOne(ld => ld.Language)
                .WithMany(l => l.Dictionaries)
                .HasForeignKey(ld => ld.LanguageId)
                .OnDelete(DeleteBehavior.Cascade); // If Language is deleted, delete its dictionaries

            // Configure Language -> LanguageSentenceSplitException: One-to-Many
            modelBuilder.Entity<LanguageSentenceSplitException>()
                .HasOne(lse => lse.Language)
                .WithMany(l => l.SentenceSplitExceptions)
                .HasForeignKey(lse => lse.LanguageId)
                .OnDelete(DeleteBehavior.Cascade); // If Language is deleted, delete its exceptions

            // Configure UserLanguageStatistics
            modelBuilder.Entity<UserLanguageStatistics>()
                .HasKey(uls => uls.UserLanguageStatisticsId); // Use single primary key

            modelBuilder.Entity<UserLanguageStatistics>()
                .HasIndex(uls => new { uls.UserId, uls.LanguageId }) // Add unique index for User/Language combo
                .IsUnique();

            modelBuilder.Entity<UserLanguageStatistics>()
                .HasOne(uls => uls.User)
                .WithMany() // No collection navigation property in User
                .HasForeignKey(uls => uls.UserId)
                .OnDelete(DeleteBehavior.Cascade); // If user deleted, delete their stats

            modelBuilder.Entity<UserLanguageStatistics>()
                .HasOne(uls => uls.Language)
                .WithMany() // No collection navigation property in Language
                .HasForeignKey(uls => uls.LanguageId)
                .OnDelete(DeleteBehavior.Restrict); // Don't delete language if stats exist

            // Configure UserAudioLessonProgress entity
            modelBuilder.Entity<UserAudioLessonProgress>()
                .HasKey(ualp => new { ualp.UserId, ualp.TextId }); // Composite primary key

            modelBuilder.Entity<UserAudioLessonProgress>()
                .HasOne(ualp => ualp.User)
                .WithMany() // No collection navigation property in User for this
                .HasForeignKey(ualp => ualp.UserId)
                .OnDelete(DeleteBehavior.Cascade); // If user is deleted, delete their progress

            modelBuilder.Entity<UserAudioLessonProgress>()
                .HasOne(ualp => ualp.Text)
                .WithMany() // No collection navigation property in Text for this
                .HasForeignKey(ualp => ualp.TextId)
                .OnDelete(DeleteBehavior.Cascade); // If text (lesson) is deleted, delete its progress records

            // Configure UserSentenceProgress entity
            modelBuilder.Entity<UserSentenceProgress>()
                .HasKey(usp => new { usp.UserId, usp.TextId });

            modelBuilder.Entity<UserSentenceProgress>()
                .HasOne(usp => usp.User)
                .WithMany()
                .HasForeignKey(usp => usp.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<UserSentenceProgress>()
                .HasOne(usp => usp.Text)
                .WithMany()
                .HasForeignKey(usp => usp.TextId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure SrsCardReview entity
            modelBuilder.Entity<SrsCardReview>()
                .HasIndex(scr => new { scr.UserId, scr.WordId })
                .IsUnique();

            modelBuilder.Entity<SrsCardReview>()
                .HasIndex(scr => new { scr.UserId, scr.NextReviewAt });

            modelBuilder.Entity<SrsCardReview>()
                .HasOne(scr => scr.User)
                .WithMany()
                .HasForeignKey(scr => scr.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<SrsCardReview>()
                .HasOne(scr => scr.Word)
                .WithMany()
                .HasForeignKey(scr => scr.WordId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure SrsReviewLog entity
            modelBuilder.Entity<SrsReviewLog>()
                .HasOne(srl => srl.User)
                .WithMany()
                .HasForeignKey(srl => srl.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<SrsReviewLog>()
                .HasOne(srl => srl.SrsCardReview)
                .WithMany()
                .HasForeignKey(srl => srl.SrsCardReviewId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure SrsPhrase entity
            modelBuilder.Entity<SrsPhrase>()
                .HasOne(sp => sp.User)
                .WithMany()
                .HasForeignKey(sp => sp.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<SrsPhrase>()
                .HasOne(sp => sp.Word)
                .WithMany()
                .HasForeignKey(sp => sp.WordId)
                .OnDelete(DeleteBehavior.Restrict); // Don't cascade from Word to avoid multiple paths

            modelBuilder.Entity<SrsPhrase>()
                .HasOne(sp => sp.Text)
                .WithMany()
                .HasForeignKey(sp => sp.TextId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull); // If text deleted, keep phrase but null out TextId

            // Configure Folder entity
            modelBuilder.Entity<Folder>()
                .HasOne(f => f.User)
                .WithMany()
                .HasForeignKey(f => f.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<Folder>()
                .HasOne(f => f.Language)
                .WithMany()
                .HasForeignKey(f => f.LanguageId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull);

            modelBuilder.Entity<Folder>()
                .HasOne(f => f.ParentFolder)
                .WithMany(f => f.ChildFolders)
                .HasForeignKey(f => f.ParentFolderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict); // Don't cascade delete children — move to parent instead

            modelBuilder.Entity<Folder>()
                .HasIndex(f => new { f.UserId, f.ParentFolderId });

            // Folder - Text: One-to-Many
            modelBuilder.Entity<Text>()
                .HasOne(t => t.Folder)
                .WithMany(f => f.Texts)
                .HasForeignKey(t => t.FolderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull); // If folder deleted, texts move to root

            // Folder - Book: One-to-Many
            modelBuilder.Entity<Book>()
                .HasOne(b => b.Folder)
                .WithMany(f => f.Books)
                .HasForeignKey(b => b.FolderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.SetNull); // If folder deleted, books move to root
        }
    }
}