using System.Text;
using System.Text.RegularExpressions;

namespace LinguaReadApi.Services.Tokenization;

/// <summary>
/// Lookup-only Korean canonical aliases. Never use these to rewrite stored terms
/// or displayed text: compatibility Jamo and conflicting vocabulary rows stay distinct.
/// Callers supply their existing trimmed/cased exact keys.
/// </summary>
public static class KoreanLookup
{
    public static bool IsKoreanLanguageCode(string? code) =>
        string.Equals((code ?? string.Empty).Trim().Replace('_', '-').Split('-')[0], "ko", StringComparison.OrdinalIgnoreCase);

    public sealed record Projection(string Text, IReadOnlyList<int> SourceStarts, IReadOnlyList<int> SourceEnds);
    public readonly record struct SourceSpan(int Start, int End);

    public sealed record KoreanTokenAnalysis(string Lemma, string Particle, string ParticleType);

    private enum BatchimCondition
    {
        Any,
        RequiresBatchim,
        RequiresNoBatchim,
        RequiresNonRieulBatchim,
        RequiresNoBatchimOrRieul
    }

    private sealed record ParticleRule(string Particle, BatchimCondition Condition, string ParticleType);

    public static bool HasBatchim(char c) => c is >= '\uac00' and <= '\ud7a3' && (c - 0xac00) % 28 > 0;

    public static int GetBatchim(char c) => c is >= '\uac00' and <= '\ud7a3' ? (c - 0xac00) % 28 : 0;

    private static bool CheckBatchim(char c, BatchimCondition condition)
    {
        if (c is < '\uac00' or > '\ud7a3') return false;
        var jong = (c - 0xac00) % 28;
        return condition switch
        {
            BatchimCondition.Any => true,
            BatchimCondition.RequiresBatchim => jong > 0,
            BatchimCondition.RequiresNoBatchim => jong == 0,
            BatchimCondition.RequiresNonRieulBatchim => jong > 0 && jong != 8,
            BatchimCondition.RequiresNoBatchimOrRieul => jong == 0 || jong == 8,
            _ => false
        };
    }

    // Free 1-syllable noun whitelist (~160 common words)
    private static readonly HashSet<string> OneSyllableNouns = new(StringComparer.Ordinal)
    {
        "책", "집", "밥", "물", "눈", "손", "발", "말", "일", "길", "꽃", "돈", "술", "옷", "방", "문",
        "산", "강", "달", "별", "해", "비", "차", "배", "숲", "밤", "낮", "꿈", "땀", "힘", "흙", "돌",
        "새", "소", "개", "닭", "쥐", "곰", "뱀", "봄", "빵", "떡", "면", "콩", "쌀", "살", "피", "뼈",
        "귀", "코", "입", "이", "턱", "목", "등", "팔", "볼", "혀", "털", "몸", "간", "골", "땅", "풀",
        "잎", "씨", "빛", "색", "맛", "멋", "끝", "값", "빚", "글", "뜻", "날", "곳", "점", "속", "겉",
        "앞", "뒤", "밑", "위", "옆", "칼", "줄", "끈", "통", "병", "잔", "상", "벽", "창", "총", "활",
        "솥", "잠", "숨", "정", "덕", "복", "한", "얼", "넋", "티", "짐", "법", "시", "분", "초", "쪽",
        "편", "짝", "놈", "남", "적", "신", "철", "국", "탕", "죽", "회", "김", "꿀", "깨", "감", "귤",
        "잣", "알", "양", "벌", "용", "꿩", "늪", "샘", "틀", "못", "닻", "돛", "갓", "탈", "윷", "틈",
        "덤", "몫", "꼴", "때", "첫", "약", "불", "춤", "키", "빗", "삯", "볕", "판", "품", "결", "곁"
    };

    private static readonly HashSet<string> AgentNouns = new(StringComparer.Ordinal)
    {
        "정치가", "만화가", "음악가", "소설가", "전문가", "예술가", "자본가", "사업가", "운동가", "작가",
        "화가", "건축가", "사진가", "사상가", "비평가", "평론가", "연출가", "과학가", "무용가", "철학가", "탐험가"
    };

    private static readonly HashSet<string> LoanwordsNa = new(StringComparer.Ordinal)
    {
        "바나나", "코로나", "사우나", "안테나"
    };

    private static readonly HashSet<string> ProtectedWords = new(StringComparer.Ordinal)
    {
        "오이", "포도", "사자", "지도", "고속도로", "민주주의", "바나나", "코로나", "정치가", "만화가",
        "선거제도", "교육제도", "사법제도", "한반도", "피아노", "카메라", "드라마", "시네마"
    };

    private static readonly ParticleRule[] Copulas =
    {
        new("입니다", BatchimCondition.Any, "Copula"),
        new("이에요", BatchimCondition.RequiresBatchim, "Copula"),
        new("예요", BatchimCondition.RequiresNoBatchim, "Copula"),
        new("이다", BatchimCondition.Any, "Copula"),
        new("이었다", BatchimCondition.RequiresBatchim, "Copula"),
        new("였다", BatchimCondition.RequiresNoBatchim, "Copula")
    };

    private static readonly ParticleRule[] Slot3Rules =
    {
        new("이나마", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("나마", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이라도", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("라도", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이라서", BatchimCondition.RequiresBatchim, "Causal Marker"),
        new("라서", BatchimCondition.RequiresNoBatchim, "Causal Marker"),
        new("이란", BatchimCondition.RequiresBatchim, "Topic Marker"),
        new("란", BatchimCondition.RequiresNoBatchim, "Topic Marker"),
        new("이나", BatchimCondition.RequiresBatchim, "Delimiter"),
        new("나", BatchimCondition.RequiresNoBatchim, "Delimiter"),
        new("이며", BatchimCondition.RequiresBatchim, "Connective Marker"),
        new("며", BatchimCondition.RequiresNoBatchim, "Connective Marker"),
        new("부터", BatchimCondition.Any, "Starting Point Marker"),
        new("까지", BatchimCondition.Any, "Ending Point Marker"),
        new("은", BatchimCondition.RequiresBatchim, "Topic Marker"),
        new("는", BatchimCondition.RequiresNoBatchim, "Topic Marker"),
        new("이", BatchimCondition.RequiresBatchim, "Subject Marker"),
        new("가", BatchimCondition.RequiresNoBatchim, "Subject Marker"),
        new("을", BatchimCondition.RequiresBatchim, "Object Marker"),
        new("를", BatchimCondition.RequiresNoBatchim, "Object Marker"),
        new("도", BatchimCondition.Any, "Additive Marker"),
        new("만", BatchimCondition.Any, "Exclusive Marker"),
        new("아", BatchimCondition.RequiresBatchim, "Vocative Marker"),
        new("야", BatchimCondition.RequiresNoBatchim, "Vocative Marker")
    };

    private static readonly ParticleRule[] Slot2Rules =
    {
        new("으로서", BatchimCondition.RequiresNonRieulBatchim, "Role Marker"),
        new("으로써", BatchimCondition.RequiresNonRieulBatchim, "Instrumental Marker"),
        new("로서", BatchimCondition.RequiresNoBatchimOrRieul, "Role Marker"),
        new("로써", BatchimCondition.RequiresNoBatchimOrRieul, "Instrumental Marker"),
        new("으로", BatchimCondition.RequiresNonRieulBatchim, "Instrumental Marker"),
        new("로", BatchimCondition.RequiresNoBatchimOrRieul, "Instrumental Marker"),
        new("께서", BatchimCondition.Any, "Honorific Subject Marker"),
        new("에서", BatchimCondition.Any, "Locative Marker"),
        new("에게", BatchimCondition.Any, "Dative Marker"),
        new("한테", BatchimCondition.Any, "Dative Marker"),
        new("하고", BatchimCondition.Any, "Connective Marker"),
        new("보다", BatchimCondition.Any, "Comparative Marker"),
        new("처럼", BatchimCondition.Any, "Comparative Marker"),
        new("마다", BatchimCondition.Any, "Every"),
        new("조차", BatchimCondition.Any, "Even"),
        new("마저", BatchimCondition.Any, "Even"),
        new("께", BatchimCondition.Any, "Honorific Dative Marker"),
        new("에", BatchimCondition.Any, "Locative/Time Marker"),
        new("과", BatchimCondition.RequiresBatchim, "Connective Marker"),
        new("와", BatchimCondition.RequiresNoBatchim, "Connective Marker"),
        new("의", BatchimCondition.Any, "Possessive Marker")
    };

    private static string CombineParticleTypes(string? plural, string? slot2Type, string? slot3Type)
    {
        if (plural != null)
        {
            if (slot2Type != null && slot3Type != null)
                return $"Plural + {slot2Type.Replace(" Marker", "")} + {slot3Type}";
            if (slot2Type != null)
                return $"Plural + {slot2Type}";
            if (slot3Type != null)
                return $"Plural + {slot3Type}";
            return "Plural Marker";
        }

        if (slot2Type != null && slot3Type != null)
            return $"{slot2Type.Replace(" Marker", "")} + {slot3Type}";
        if (slot2Type != null) return slot2Type;
        if (slot3Type != null) return slot3Type;
        return string.Empty;
    }

    private static bool ShouldSkipParticle(string target, string particle)
    {
        if (particle == "로" || particle.StartsWith("로"))
        {
            if (target.EndsWith("으로")) return true;
            if (target.EndsWith("도로") && target.Length >= 3) return true;
        }
        if (particle == "의" || particle.StartsWith("의"))
        {
            if (target.EndsWith("주의") && target.Length >= 3) return true;
        }
        if (particle == "도")
        {
            if ((target.EndsWith("제도") || target.EndsWith("반도")) && target.Length >= 3) return true;
        }
        if (particle == "가" && AgentNouns.Contains(target))
        {
            return true;
        }
        if (particle == "나" && LoanwordsNa.Contains(target))
        {
            return true;
        }
        return false;
    }

    private static bool IsStemValid(string stem, string surface, string particle)
    {
        if (string.IsNullOrEmpty(stem)) return false;
        foreach (var ch in stem)
        {
            if (ch is < '\uac00' or > '\ud7a3') return false;
        }

        if (stem.Length == 1 && !OneSyllableNouns.Contains(stem))
        {
            return false;
        }

        if (ProtectedWords.Contains(surface))
        {
            return false;
        }

        if (particle.EndsWith("로") && surface.EndsWith("도로"))
        {
            return false;
        }

        if (particle.EndsWith("의") && surface.EndsWith("주의"))
        {
            return false;
        }

        if (particle.EndsWith("도") && (surface.EndsWith("제도") || surface.EndsWith("반도")))
        {
            return false;
        }

        if (particle == "가" && AgentNouns.Contains(surface))
        {
            return false;
        }

        if (particle == "나" && LoanwordsNa.Contains(surface))
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// Decomposes an inflected Korean surface form into its base lemma, attached particle(s),
    /// and particle classification badge. Returns null if no particle is attached.
    /// </summary>
    public static KoreanTokenAnalysis? AnalyzeKoreanToken(string surface)
    {
        if (string.IsNullOrWhiteSpace(surface)) return null;
        var s = ComposeHangul(surface);
        if (s.Length < 2) return null;
        foreach (var ch in s)
        {
            if (ch is < '\uac00' or > '\ud7a3') return null;
        }

        // 1. Check copula endings
        foreach (var copula in Copulas)
        {
            if (s.EndsWith(copula.Particle))
            {
                var charBefore = s[s.Length - copula.Particle.Length - 1];
                if (CheckBatchim(charBefore, copula.Condition))
                {
                    var rem = s[..^copula.Particle.Length];
                    if (rem.EndsWith("들") && rem.Length >= 2)
                    {
                        var remWithoutDeul = rem[..^1];
                        var fullParticle = s[remWithoutDeul.Length..];
                        if (IsStemValid(remWithoutDeul, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(remWithoutDeul, fullParticle, "Plural + Copula");
                        }
                    }

                    var particle = s[rem.Length..];
                    if (IsStemValid(rem, s, particle))
                    {
                        return new KoreanTokenAnalysis(rem, particle, copula.ParticleType);
                    }
                }
            }
        }

        // 2. Check Slot 3 (optionally preceded by Slot 2, optionally preceded by Slot 1 -들)
        foreach (var slot3 in Slot3Rules)
        {
            if (s.EndsWith(slot3.Particle))
            {
                if (ShouldSkipParticle(s, slot3.Particle)) continue;
                var charBefore = s[s.Length - slot3.Particle.Length - 1];
                if (CheckBatchim(charBefore, slot3.Condition))
                {
                    var rem1 = s[..^slot3.Particle.Length];

                    // Can Slot 2 attach before Slot 3?
                    foreach (var slot2 in Slot2Rules)
                    {
                        if (rem1.EndsWith(slot2.Particle))
                        {
                            if (ShouldSkipParticle(rem1, slot2.Particle)) continue;
                            var charBefore2 = rem1[rem1.Length - slot2.Particle.Length - 1];
                            if (CheckBatchim(charBefore2, slot2.Condition))
                            {
                                var rem2 = rem1[..^slot2.Particle.Length];
                                if (rem2.EndsWith("들") && rem2.Length >= 2)
                                {
                                    var rem3 = rem2[..^1];
                                    var fullParticle = s[rem3.Length..];
                                    if (IsStemValid(rem3, s, fullParticle))
                                    {
                                        return new KoreanTokenAnalysis(rem3, fullParticle, CombineParticleTypes("Plural Marker", slot2.ParticleType, slot3.ParticleType));
                                    }
                                }

                                var particle23 = s[rem2.Length..];
                                if (IsStemValid(rem2, s, particle23))
                                {
                                    return new KoreanTokenAnalysis(rem2, particle23, CombineParticleTypes(null, slot2.ParticleType, slot3.ParticleType));
                                }
                            }
                        }
                    }

                    // No Slot 2; check -들 before Slot 3
                    if (rem1.EndsWith("들") && rem1.Length >= 2)
                    {
                        var rem2 = rem1[..^1];
                        var fullParticle = s[rem2.Length..];
                        if (IsStemValid(rem2, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(rem2, fullParticle, CombineParticleTypes("Plural Marker", null, slot3.ParticleType));
                        }
                    }

                    var particle3 = s[rem1.Length..];
                    if (IsStemValid(rem1, s, particle3))
                    {
                        return new KoreanTokenAnalysis(rem1, particle3, slot3.ParticleType);
                    }
                }
            }
        }

        // 3. Check Slot 2 only (optionally preceded by Slot 1 -들)
        foreach (var slot2 in Slot2Rules)
        {
            if (s.EndsWith(slot2.Particle))
            {
                if (ShouldSkipParticle(s, slot2.Particle)) continue;
                var charBefore = s[s.Length - slot2.Particle.Length - 1];
                if (CheckBatchim(charBefore, slot2.Condition))
                {
                    var rem1 = s[..^slot2.Particle.Length];
                    if (rem1.EndsWith("들") && rem1.Length >= 2)
                    {
                        var rem2 = rem1[..^1];
                        var fullParticle = s[rem2.Length..];
                        if (IsStemValid(rem2, s, fullParticle))
                        {
                            return new KoreanTokenAnalysis(rem2, fullParticle, CombineParticleTypes("Plural Marker", slot2.ParticleType, null));
                        }
                    }

                    var particle2 = s[rem1.Length..];
                    if (IsStemValid(rem1, s, particle2))
                    {
                        return new KoreanTokenAnalysis(rem1, particle2, slot2.ParticleType);
                    }
                }
            }
        }

        // 4. Check Slot 1 -들 only
        if (s.EndsWith("들") && s.Length >= 2)
        {
            var rem = s[..^1];
            if (IsStemValid(rem, s, "들"))
            {
                return new KoreanTokenAnalysis(rem, "들", "Plural Marker");
            }
        }

        return null;
    }

    /// <summary>Each composed UTF-16 unit maps to its complete original source span.</summary>
    public static Projection Project(string source)
    {
        var text = new StringBuilder(source.Length);
        var starts = new List<int>(source.Length);
        var ends = new List<int>(source.Length);
        for (var start = 0; start < source.Length;)
        {
            var code = (int)source[start];
            var end = start + 1;
            if (code is >= 0x1100 and <= 0x1112 && end < source.Length && source[end] is >= '\u1161' and <= '\u1175')
            {
                code = 0xac00 + ((code - 0x1100) * 21 + source[end] - 0x1161) * 28;
                end++;
            }
            if (code is >= 0xac00 and <= 0xd7a3 && (code - 0xac00) % 28 == 0
                && end < source.Length && source[end] is >= '\u11a8' and <= '\u11c2')
            {
                code += source[end] - 0x11a7;
                end++;
            }
            text.Append((char)code);
            starts.Add(start);
            ends.Add(end);
            start = end;
        }
        return new Projection(text.ToString(), starts, ends);
    }

    public static string ComposeHangul(string source) => Project(source).Text;

    public sealed class Index<T> where T : class
    {
        private readonly Dictionary<string, T?> exact = new(StringComparer.Ordinal);
        private readonly Dictionary<string, T?> canonical = new(StringComparer.Ordinal);

        internal Index(IEnumerable<T> rows, Func<T, string> exactKey)
        {
            foreach (var row in rows) Add(row, exactKey);
        }

        /// <summary>Register a newly pending row without rebuilding the language index.</summary>
        public void Add(T row, Func<T, string> exactKey)
        {
            var key = exactKey(row);
            exact[key] = exact.ContainsKey(key) ? null : row;
            var alias = ComposeHangul(key);
            canonical[alias] = canonical.ContainsKey(alias) ? null : row;
        }

        /// <summary>Exact spelling wins; an alias with multiple candidates has no winner.</summary>
        public T? Resolve(string exactKey) => exact.TryGetValue(exactKey, out var row)
            ? row
            : canonical.GetValueOrDefault(ComposeHangul(exactKey));

        /// <summary>True also for an exact key whose stored rows conflict.</summary>
        public bool ContainsExact(string exactKey) => exact.ContainsKey(exactKey);
    }

    public static Index<T> CreateIndex<T>(IEnumerable<T> rows, Func<T, string> exactKey) where T : class => new(rows, exactKey);

    /// <summary>Canonical matches with offsets in the unmodified source, including phrases.</summary>
    public static IReadOnlyList<SourceSpan> FindMatches(string source, string term)
    {
        var projection = Project(source);
        var needle = ComposeHangul(term);
        if (needle.Length == 0) return Array.Empty<SourceSpan>();
        return Regex.Matches(projection.Text, Regex.Escape(needle), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            .Select(match => new SourceSpan(projection.SourceStarts[match.Index], projection.SourceEnds[match.Index + match.Length - 1]))
            .ToArray();
    }
}
