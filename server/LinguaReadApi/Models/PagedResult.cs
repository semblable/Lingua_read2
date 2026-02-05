using System.Collections.Generic;

namespace LinguaReadApi.Models
{
    public class PagedResult<T>
    {
        public required IEnumerable<T> Items { get; set; }
        public int TotalCount { get; set; }
        public int PageNumber { get; set; }
        public int PageSize { get; set; }
        public int TotalPages { get; set; }
    }
}
