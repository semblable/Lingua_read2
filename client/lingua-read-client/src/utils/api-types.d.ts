/**
 * AUTO-GENERATED. Do not edit by hand.
 *
 * Regenerate with: npm run api:types
 * Source: backend Swagger (Swashbuckle.AspNetCore) at /swagger/v1/swagger.json
 */
export interface paths {
    "/api/Admin/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Admin/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        /** Format: binary */
                        backupFile?: string;
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Admin/discord/weekly-report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    dryRun?: boolean;
                    force?: boolean;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["LoginRequest"];
                    "text/json": components["schemas"]["LoginRequest"];
                    "application/*+json": components["schemas"]["LoginRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Auth/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Auth/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SetupRequest"];
                    "text/json": components["schemas"]["SetupRequest"];
                    "application/*+json": components["schemas"]["SetupRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["BookDto"][];
                        "application/json": components["schemas"]["BookDto"][];
                        "text/json": components["schemas"]["BookDto"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateBookDto"];
                    "text/json": components["schemas"]["CreateBookDto"];
                    "application/*+json": components["schemas"]["CreateBookDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["BookDto"];
                        "application/json": components["schemas"]["BookDto"];
                        "text/json": components["schemas"]["BookDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["BookDetailDto"];
                        "application/json": components["schemas"]["BookDetailDto"];
                        "text/json": components["schemas"]["BookDetailDto"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateBookDto"];
                    "text/json": components["schemas"]["UpdateBookDto"];
                    "application/*+json": components["schemas"]["UpdateBookDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        /** Format: int32 */
                        LanguageId: number;
                        Tags?: string[];
                        /** Format: binary */
                        File: string;
                        TitleOverride?: string;
                        SplitMethod: string;
                        /** Format: int32 */
                        MaxSegmentSize: number;
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["BookDto"];
                        "application/json": components["schemas"]["BookDto"];
                        "text/json": components["schemas"]["BookDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{bookId}/audiobook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        Files: string[];
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{id}/lastread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateLastReadDto"];
                    "text/json": components["schemas"]["UpdateLastReadDto"];
                    "application/*+json": components["schemas"]["UpdateLastReadDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{id}/complete-lesson": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CompleteLessonDto"];
                    "text/json": components["schemas"]["CompleteLessonDto"];
                    "application/*+json": components["schemas"]["CompleteLessonDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["BookStatsDto"];
                        "application/json": components["schemas"]["BookStatsDto"];
                        "text/json": components["schemas"]["BookStatsDto"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{id}/finish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FinishBookRequest"];
                    "text/json": components["schemas"]["FinishBookRequest"];
                    "application/*+json": components["schemas"]["FinishBookRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Books/{id}/next-lesson": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    currentTextId?: number;
                };
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["NextLessonDto"];
                        "application/json": components["schemas"]["NextLessonDto"];
                        "text/json": components["schemas"]["NextLessonDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/DataManagement/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/DataManagement/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        /** Format: binary */
                        backupFile?: string;
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["FolderDto"][];
                        "application/json": components["schemas"]["FolderDto"][];
                        "text/json": components["schemas"]["FolderDto"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateFolderDto"];
                    "text/json": components["schemas"]["CreateFolderDto"];
                    "application/*+json": components["schemas"]["CreateFolderDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["FolderDto"];
                        "application/json": components["schemas"]["FolderDto"];
                        "text/json": components["schemas"]["FolderDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders/library": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    folderId?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["LibraryContentsDto"];
                        "application/json": components["schemas"]["LibraryContentsDto"];
                        "text/json": components["schemas"]["LibraryContentsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateFolderDto"];
                    "text/json": components["schemas"]["UpdateFolderDto"];
                    "application/*+json": components["schemas"]["UpdateFolderDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders/delete-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: {
                    textIds?: string;
                    bookIds?: string;
                    folderIds?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders/move-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["MoveItemsDto"];
                    "text/json": components["schemas"]["MoveItemsDto"];
                    "application/*+json": components["schemas"]["MoveItemsDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Folders/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ReorderItemsDto"];
                    "text/json": components["schemas"]["ReorderItemsDto"];
                    "application/*+json": components["schemas"]["ReorderItemsDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    status?: string;
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["GoalProgressDto"][];
                        "application/json": components["schemas"]["GoalProgressDto"][];
                        "text/json": components["schemas"]["GoalProgressDto"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateGoalDto"];
                    "text/json": components["schemas"]["CreateGoalDto"];
                    "application/*+json": components["schemas"]["CreateGoalDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["GoalProgressDto"];
                        "application/json": components["schemas"]["GoalProgressDto"];
                        "text/json": components["schemas"]["GoalProgressDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Goals/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["GoalProgressDto"];
                        "application/json": components["schemas"]["GoalProgressDto"];
                        "text/json": components["schemas"]["GoalProgressDto"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: {
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateGoalDto"];
                    "text/json": components["schemas"]["UpdateGoalDto"];
                    "application/*+json": components["schemas"]["UpdateGoalDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["GoalProgressDto"];
                        "application/json": components["schemas"]["GoalProgressDto"];
                        "text/json": components["schemas"]["GoalProgressDto"];
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Goals/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Goals/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Goals/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    type?: components["schemas"]["GoalType"];
                    languageId?: number;
                    recurrence?: components["schemas"]["GoalRecurrence"];
                    mode?: components["schemas"]["GoalMode"];
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["GoalSuggestionDto"];
                        "application/json": components["schemas"]["GoalSuggestionDto"];
                        "text/json": components["schemas"]["GoalSuggestionDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Hardcover/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["HardcoverConnectionResult"];
                        "application/json": components["schemas"]["HardcoverConnectionResult"];
                        "text/json": components["schemas"]["HardcoverConnectionResult"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Hardcover/match/{bookId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["HardcoverMatchRequest"];
                    "text/json": components["schemas"]["HardcoverMatchRequest"];
                    "application/*+json": components["schemas"]["HardcoverMatchRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["HardcoverMatchResult"];
                        "application/json": components["schemas"]["HardcoverMatchResult"];
                        "text/json": components["schemas"]["HardcoverMatchResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Hardcover/import-metadata/{bookId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["HardcoverMetadataImportResult"];
                        "application/json": components["schemas"]["HardcoverMetadataImportResult"];
                        "text/json": components["schemas"]["HardcoverMetadataImportResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Hardcover/sync-progress/{bookId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["HardcoverProgressSyncResult"];
                        "application/json": components["schemas"]["HardcoverProgressSyncResult"];
                        "text/json": components["schemas"]["HardcoverProgressSyncResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Hardcover/sync-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["HardcoverSyncAllResult"];
                        "application/json": components["schemas"]["HardcoverSyncAllResult"];
                        "text/json": components["schemas"]["HardcoverSyncAllResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Languages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["Language"][];
                        "application/json": components["schemas"]["Language"][];
                        "text/json": components["schemas"]["Language"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["Language"];
                    "text/json": components["schemas"]["Language"];
                    "application/*+json": components["schemas"]["Language"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["Language"];
                        "application/json": components["schemas"]["Language"];
                        "text/json": components["schemas"]["Language"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Languages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["Language"];
                        "application/json": components["schemas"]["Language"];
                        "text/json": components["schemas"]["Language"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["Language"];
                    "text/json": components["schemas"]["Language"];
                    "application/*+json": components["schemas"]["Language"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Languages/{id}/reset-content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/SentenceTranslation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SentenceTranslationRequest"];
                    "text/json": components["schemas"]["SentenceTranslationRequest"];
                    "application/*+json": components["schemas"]["SentenceTranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SentenceTranslationResponse"];
                        "application/json": components["schemas"]["SentenceTranslationResponse"];
                        "text/json": components["schemas"]["SentenceTranslationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/SentenceTranslation/full-text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SentenceTranslationRequest"];
                    "text/json": components["schemas"]["SentenceTranslationRequest"];
                    "application/*+json": components["schemas"]["SentenceTranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SentenceTranslationResponse"];
                        "application/json": components["schemas"]["SentenceTranslationResponse"];
                        "text/json": components["schemas"]["SentenceTranslationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/SentenceTranslation/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SentenceTranslationRequest"];
                    "text/json": components["schemas"]["SentenceTranslationRequest"];
                    "application/*+json": components["schemas"]["SentenceTranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SentenceExplanationResponse"];
                        "application/json": components["schemas"]["SentenceExplanationResponse"];
                        "text/json": components["schemas"]["SentenceExplanationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/SentenceTranslation/selection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SelectionTranslationRequest"];
                    "text/json": components["schemas"]["SelectionTranslationRequest"];
                    "application/*+json": components["schemas"]["SelectionTranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SelectionTranslationResponse"];
                        "application/json": components["schemas"]["SelectionTranslationResponse"];
                        "text/json": components["schemas"]["SelectionTranslationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/due": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                    status?: string;
                    onlyOneTarget?: boolean;
                    flag?: number;
                    tags?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsDueCardDto"][];
                        "application/json": components["schemas"]["SrsDueCardDto"][];
                        "text/json": components["schemas"]["SrsDueCardDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SrsReviewSubmitDto"];
                    "text/json": components["schemas"]["SrsReviewSubmitDto"];
                    "application/*+json": components["schemas"]["SrsReviewSubmitDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SrsMineDto"];
                    "text/json": components["schemas"]["SrsMineDto"];
                    "application/*+json": components["schemas"]["SrsMineDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/last-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsReviewLogDto"];
                        "application/json": components["schemas"]["SrsReviewLogDto"];
                        "text/json": components["schemas"]["SrsReviewLogDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/forecast": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                    days?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsForecastDto"][];
                        "application/json": components["schemas"]["SrsForecastDto"][];
                        "text/json": components["schemas"]["SrsForecastDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/phrases/{wordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wordId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsPhraseDto"][];
                        "application/json": components["schemas"]["SrsPhraseDto"][];
                        "text/json": components["schemas"]["SrsPhraseDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/phrases/{phraseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    phraseId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsStatsDto"];
                        "application/json": components["schemas"]["SrsStatsDto"];
                        "text/json": components["schemas"]["SrsStatsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/suspend/{cardId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cardId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/unsuspend/{cardId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cardId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/bury/{cardId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cardId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/cards/{cardId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cardId: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SrsCardPatchDto"];
                    "text/json": components["schemas"]["SrsCardPatchDto"];
                    "application/*+json": components["schemas"]["SrsCardPatchDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        trace?: never;
    };
    "/api/Srs/heatmap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    days?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsHeatmapDto"][];
                        "application/json": components["schemas"]["SrsHeatmapDto"][];
                        "text/json": components["schemas"]["SrsHeatmapDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/reading-credit/{wordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wordId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/stories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsStoryListDto"][];
                        "application/json": components["schemas"]["SrsStoryListDto"][];
                        "text/json": components["schemas"]["SrsStoryListDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/analytics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsAnalyticsDto"];
                        "application/json": components["schemas"]["SrsAnalyticsDto"];
                        "text/json": components["schemas"]["SrsAnalyticsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Srs/story-generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SrsStoryGenerateRequest"];
                    "text/json": components["schemas"]["SrsStoryGenerateRequest"];
                    "application/*+json": components["schemas"]["SrsStoryGenerateRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SrsStoryGenerateResponse"];
                        "application/json": components["schemas"]["SrsStoryGenerateResponse"];
                        "text/json": components["schemas"]["SrsStoryGenerateResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/StoryGeneration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["StoryGenerationRequest"];
                    "text/json": components["schemas"]["StoryGenerationRequest"];
                    "application/*+json": components["schemas"]["StoryGenerationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["StoryGenerationResponse"];
                        "application/json": components["schemas"]["StoryGenerationResponse"];
                        "text/json": components["schemas"]["StoryGenerationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Summarization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SummarizationRequest"];
                    "text/json": components["schemas"]["SummarizationRequest"];
                    "application/*+json": components["schemas"]["SummarizationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SummarizationResponse"];
                        "application/json": components["schemas"]["SummarizationResponse"];
                        "text/json": components["schemas"]["SummarizationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TextDto"][];
                        "application/json": components["schemas"]["TextDto"][];
                        "text/json": components["schemas"]["TextDto"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateTextDto"];
                    "text/json": components["schemas"]["CreateTextDto"];
                    "application/*+json": components["schemas"]["CreateTextDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TextDto"];
                        "application/json": components["schemas"]["TextDto"];
                        "text/json": components["schemas"]["TextDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TextDetailDto"];
                        "application/json": components["schemas"]["TextDetailDto"];
                        "text/json": components["schemas"]["TextDetailDto"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateTextDto"];
                    "text/json": components["schemas"]["UpdateTextDto"];
                    "application/*+json": components["schemas"]["UpdateTextDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/{id}/srt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": string;
                        "application/json": string;
                        "text/json": string;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/{id}/word-linking-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["RecentTextDto"][];
                        "application/json": components["schemas"]["RecentTextDto"][];
                        "text/json": components["schemas"]["RecentTextDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/admin/relink-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/admin/recompute-stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        Title: string;
                        /** Format: int32 */
                        LanguageId: number;
                        /** Format: binary */
                        AudioFile: string;
                        /** Format: binary */
                        SrtFile: string;
                        Tag?: string;
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TextDto"];
                        "application/json": components["schemas"]["TextDto"];
                        "text/json": components["schemas"]["TextDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/audio/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "multipart/form-data": {
                        /** Format: int32 */
                        LanguageId: number;
                        Tag?: string;
                        files?: string[];
                    };
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Texts/{textId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: {
                    skipStats?: boolean;
                };
                header?: never;
                path: {
                    textId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TextStatsDto"];
                        "application/json": components["schemas"]["TextStatsDto"];
                        "text/json": components["schemas"]["TextStatsDto"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Translation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["TranslationRequest"];
                    "text/json": components["schemas"]["TranslationRequest"];
                    "application/*+json": components["schemas"]["TranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["TranslationResponse"];
                        "application/json": components["schemas"]["TranslationResponse"];
                        "text/json": components["schemas"]["TranslationResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Translation/languages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["LanguageInfo"][];
                        "application/json": components["schemas"]["LanguageInfo"][];
                        "text/json": components["schemas"]["LanguageInfo"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Translation/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["BatchTranslationRequest"];
                    "text/json": components["schemas"]["BatchTranslationRequest"];
                    "application/*+json": components["schemas"]["BatchTranslationRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": {
                            [key: string]: string;
                        };
                        "application/json": {
                            [key: string]: string;
                        };
                        "text/json": {
                            [key: string]: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/logListening": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["LogListeningRequest"];
                    "text/json": components["schemas"]["LogListeningRequest"];
                    "application/*+json": components["schemas"]["LogListeningRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/logManual": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["LogManualActivityRequest"];
                    "text/json": components["schemas"]["LogManualActivityRequest"];
                    "application/*+json": components["schemas"]["LogManualActivityRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/sentenceprogress/{textId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    textId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SentenceProgressDto"];
                        "application/json": components["schemas"]["SentenceProgressDto"];
                        "text/json": components["schemas"]["SentenceProgressDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/logSentenceRead": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["LogSentenceReadRequest"];
                    "text/json": components["schemas"]["LogSentenceReadRequest"];
                    "application/*+json": components["schemas"]["LogSentenceReadRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["SentenceProgressDto"];
                        "application/json": components["schemas"]["SentenceProgressDto"];
                        "text/json": components["schemas"]["SentenceProgressDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/reading": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["ReadingStatsDto"];
                        "application/json": components["schemas"]["ReadingStatsDto"];
                        "text/json": components["schemas"]["ReadingStatsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/listening": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["ListeningStatsDto"];
                        "application/json": components["schemas"]["ListeningStatsDto"];
                        "text/json": components["schemas"]["ListeningStatsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/audiobookprogress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateAudiobookProgressRequest"];
                    "text/json": components["schemas"]["UpdateAudiobookProgressRequest"];
                    "application/*+json": components["schemas"]["UpdateAudiobookProgressRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/audiobookprogress/{bookId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    bookId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/audiolessonprogress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateAudioLessonProgressRequest"];
                    "text/json": components["schemas"]["UpdateAudioLessonProgressRequest"];
                    "application/*+json": components["schemas"]["UpdateAudioLessonProgressRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/activity/audiolessonprogress/{textId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    textId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/statistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["UserStatisticsDto"];
                        "application/json": components["schemas"]["UserStatisticsDto"];
                        "text/json": components["schemas"]["UserStatisticsDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/reading-activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: string;
                    timezoneOffsetMinutes?: number;
                    languageId?: number;
                    offset?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/listening-activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: string;
                    timezoneOffsetMinutes?: number;
                    languageId?: number;
                    offset?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/known-words-activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: string;
                    timezoneOffsetMinutes?: number;
                    languageId?: number;
                    offset?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    timezoneOffsetMinutes?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["DashboardDto"];
                        "application/json": components["schemas"]["DashboardDto"];
                        "text/json": components["schemas"]["DashboardDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Users/reset-statistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/UserSettings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["UserSettingsDto"];
                        "application/json": components["schemas"]["UserSettingsDto"];
                        "text/json": components["schemas"]["UserSettingsDto"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateUserSettingsDto"];
                    "text/json": components["schemas"]["UpdateUserSettingsDto"];
                    "application/*+json": components["schemas"]["UpdateUserSettingsDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["UserSettingsDto"];
                        "application/json": components["schemas"]["UserSettingsDto"];
                        "text/json": components["schemas"]["UserSettingsDto"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/UserSettings/audiobook-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateAudiobookProgressDto"];
                    "text/json": components["schemas"]["UpdateAudiobookProgressDto"];
                    "application/*+json": components["schemas"]["UpdateAudiobookProgressDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/UserSettings/discord/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    period?: string;
                    days?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/UserSettings/audio-storage-size": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["AudioStorageSizeDto"];
                        "application/json": components["schemas"]["AudioStorageSizeDto"];
                        "text/json": components["schemas"]["AudioStorageSizeDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/UserSettings/test-openrouter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["OpenRouterTestResultDto"];
                        "application/json": components["schemas"]["OpenRouterTestResultDto"];
                        "text/json": components["schemas"]["OpenRouterTestResultDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateWordDto"];
                    "text/json": components["schemas"]["CreateWordDto"];
                    "application/*+json": components["schemas"]["CreateWordDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["WordResponseDto"];
                        "application/json": components["schemas"]["WordResponseDto"];
                        "text/json": components["schemas"]["WordResponseDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["WordResponseDto"];
                        "application/json": components["schemas"]["WordResponseDto"];
                        "text/json": components["schemas"]["WordResponseDto"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateWordDto"];
                    "text/json": components["schemas"]["UpdateWordDto"];
                    "application/*+json": components["schemas"]["UpdateWordDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words/language/{languageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    status?: string;
                    sortBy?: string;
                    searchTerm?: string;
                    skipSort?: boolean;
                };
                header?: never;
                path: {
                    languageId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["WordResponseDto"][];
                        "application/json": components["schemas"]["WordResponseDto"][];
                        "text/json": components["schemas"]["WordResponseDto"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words/language/{languageId}/paginated": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    page?: number;
                    pageSize?: number;
                    status?: string;
                    sortBy?: string;
                    searchTerm?: string;
                };
                header?: never;
                path: {
                    languageId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": components["schemas"]["WordResponseDtoPagedResult"];
                        "application/json": components["schemas"]["WordResponseDtoPagedResult"];
                        "text/json": components["schemas"]["WordResponseDtoPagedResult"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["AddTermBatchDto"];
                    "text/json": components["schemas"]["AddTermBatchDto"];
                    "application/*+json": components["schemas"]["AddTermBatchDto"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/Words/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    languageId?: number;
                    status?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AccuracyTrendDto: {
            date?: string | null;
            /** Format: int32 */
            totalReviews?: number;
            /** Format: int32 */
            goodReviews?: number;
            /** Format: double */
            retentionRate?: number;
        };
        AddTermBatchDto: {
            /** Format: int32 */
            languageId: number;
            terms: components["schemas"]["NewTermDto"][];
        };
        AudioStorageSizeDto: {
            /** Format: int64 */
            totalSizeBytes?: number;
            /** Format: double */
            totalSizeMB?: number;
            /** Format: double */
            totalSizeGB?: number;
            /** Format: int32 */
            totalFiles?: number;
        };
        AudiobookTrack: {
            /** Format: int32 */
            id?: number;
            /** Format: int32 */
            bookId: number;
            book?: components["schemas"]["Book"];
            filePath: string;
            /** Format: int32 */
            trackNumber: number;
            /** Format: double */
            duration?: number | null;
        };
        AudiobookTrackDto: {
            /** Format: int32 */
            trackId?: number;
            filePath?: string | null;
            /** Format: int32 */
            trackNumber?: number;
            /** Format: double */
            duration?: number | null;
        };
        BatchTranslationRequest: {
            words?: string[] | null;
            targetLanguageCode?: string | null;
            sourceLanguageCode?: string | null;
        };
        Book: {
            /** Format: int32 */
            bookId?: number;
            title: string;
            description?: string | null;
            coverImagePath?: string | null;
            author?: string | null;
            isbn13?: string | null;
            publisher?: string | null;
            /** Format: date-time */
            releaseDate?: string | null;
            /** Format: int32 */
            pageCount?: number | null;
            /** Format: int32 */
            hardcoverBookId?: number | null;
            /** Format: int32 */
            hardcoverEditionId?: number | null;
            hardcoverSlug?: string | null;
            /** Format: int32 */
            hardcoverUserBookId?: number | null;
            /** Format: int32 */
            hardcoverUserBookReadId?: number | null;
            /** Format: date-time */
            hardcoverMatchedAt?: string | null;
            /** Format: date-time */
            hardcoverLastSyncedAt?: string | null;
            /** Format: date-time */
            createdAt?: string;
            /** Format: int32 */
            lastReadPartId?: number | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: date-time */
            lastReadAt?: string | null;
            isFinished?: boolean;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            readTextIds?: number[] | null;
            /** Format: uuid */
            userId?: string;
            /** Format: int32 */
            languageId?: number;
            /** Format: int32 */
            lastReadTextId?: number | null;
            /** Format: int32 */
            folderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
            user?: components["schemas"]["User"];
            language?: components["schemas"]["Language"];
            lastReadText?: components["schemas"]["Text"];
            texts?: components["schemas"]["Text"][] | null;
            folder?: components["schemas"]["Folder"];
            bookTags?: components["schemas"]["BookTag"][] | null;
            audiobookTracks?: components["schemas"]["AudiobookTrack"][] | null;
        };
        BookDetailDto: {
            /** Format: int32 */
            bookId?: number;
            title?: string | null;
            description?: string | null;
            coverImagePath?: string | null;
            author?: string | null;
            isbn13?: string | null;
            publisher?: string | null;
            /** Format: date-time */
            releaseDate?: string | null;
            /** Format: int32 */
            pageCount?: number | null;
            languageName?: string | null;
            /** Format: int32 */
            languageId?: number;
            /** Format: date-time */
            createdAt?: string;
            /** Format: int32 */
            lastReadTextId?: number | null;
            /** Format: int32 */
            hardcoverBookId?: number | null;
            /** Format: int32 */
            hardcoverEditionId?: number | null;
            hardcoverSlug?: string | null;
            /** Format: int32 */
            hardcoverUserBookId?: number | null;
            /** Format: date-time */
            hardcoverMatchedAt?: string | null;
            /** Format: date-time */
            hardcoverLastSyncedAt?: string | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
            parts?: components["schemas"]["TextPartDto"][] | null;
            tags?: components["schemas"]["TagDto"][] | null;
            audiobookTracks?: components["schemas"]["AudiobookTrackDto"][] | null;
        };
        BookDto: {
            /** Format: int32 */
            bookId?: number;
            title?: string | null;
            description?: string | null;
            coverImagePath?: string | null;
            author?: string | null;
            isbn13?: string | null;
            publisher?: string | null;
            /** Format: date-time */
            releaseDate?: string | null;
            /** Format: int32 */
            pageCount?: number | null;
            languageName?: string | null;
            /** Format: date-time */
            createdAt?: string;
            /** Format: int32 */
            partCount?: number;
            /** Format: int32 */
            finishedPartCount?: number;
            /** Format: int32 */
            lastReadTextId?: number | null;
            /** Format: date-time */
            lastReadAt?: string | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
            isFinished?: boolean;
            /** Format: int32 */
            hardcoverBookId?: number | null;
            /** Format: int32 */
            hardcoverEditionId?: number | null;
            hardcoverSlug?: string | null;
            /** Format: int32 */
            hardcoverUserBookId?: number | null;
            /** Format: date-time */
            hardcoverMatchedAt?: string | null;
            /** Format: date-time */
            hardcoverLastSyncedAt?: string | null;
            /** Format: double */
            readonly completionPercentage?: number;
            tags?: string[] | null;
            /** Format: int32 */
            folderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
        };
        BookStatsDto: {
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: double */
            completionPercentage?: number;
            isFinished?: boolean;
        };
        BookTag: {
            /** Format: int32 */
            bookId?: number;
            book?: components["schemas"]["Book"];
            /** Format: int32 */
            tagId?: number;
            tag?: components["schemas"]["Tag"];
        };
        BreadcrumbDto: {
            /** Format: int32 */
            folderId?: number;
            name?: string | null;
        };
        ClosedPeriodDto: {
            /** Format: date */
            periodStart?: string;
            /** Format: date */
            periodEnd?: string;
            /** Format: int64 */
            finalProgress?: number;
            /** Format: int64 */
            targetAtTime?: number;
            completed?: boolean;
        };
        CompleteLessonDto: {
            /** Format: int32 */
            textId: number;
        };
        CreateBookDto: {
            title: string;
            description?: string | null;
            /** Format: int32 */
            languageId: number;
            content?: string | null;
            splitMethod: string;
            /** Format: int32 */
            maxSegmentSize: number;
            tags?: string[] | null;
        };
        CreateFolderDto: {
            name?: string | null;
            /** Format: int32 */
            parentFolderId?: number | null;
            color?: string | null;
            /** Format: int32 */
            languageId?: number | null;
        };
        CreateGoalDto: {
            /** Format: int32 */
            languageId?: number | null;
            goalType?: components["schemas"]["GoalType"];
            mode?: components["schemas"]["GoalMode"];
            recurrence?: components["schemas"]["GoalRecurrence"];
            /** Format: int64 */
            targetValue?: number;
            /** Format: date */
            deadline?: string | null;
            title?: string | null;
        };
        CreateTextDto: {
            title: string;
            content: string;
            /** Format: int32 */
            languageId: number;
            tag?: string | null;
        };
        CreateWordDto: {
            /** Format: int32 */
            textId: number;
            term: string;
            /** Format: int32 */
            status: number;
            translation?: string | null;
            sentence?: string | null;
        };
        DailyCountDto: {
            date?: string | null;
            /** Format: int32 */
            count?: number;
        };
        DashboardDto: {
            /** Format: int32 */
            totalKnownWords?: number;
            /** Format: int64 */
            totalReadingSecondsWeek?: number;
            /** Format: int32 */
            totalWordsReadWeek?: number;
            /** Format: int64 */
            totalListeningSecondsWeek?: number;
            /** Format: int32 */
            totalLanguages?: number;
            languages?: components["schemas"]["DashboardLanguageDto"][] | null;
        };
        DashboardLanguageDto: {
            /** Format: int32 */
            languageId?: number;
            languageCode?: string | null;
            languageName?: string | null;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            totalWords?: number;
            cefrLevel?: string | null;
            nextCefrLevel?: string | null;
            /** Format: int32 */
            knownWordsToNextLevel?: number;
            /** Format: int32 */
            bandProgressPercent?: number;
            isCefrApproximate?: boolean;
            /** Format: int32 */
            todayWordsRead?: number;
            /** Format: int32 */
            todayListeningSeconds?: number;
            /** Format: int32 */
            weekWordsRead?: number;
            /** Format: int32 */
            weekListeningSeconds?: number;
            /** Format: int32 */
            currentReadingStreakDays?: number;
            last14DaysWords?: components["schemas"]["DailyCountDto"][] | null;
            /** Format: int32 */
            continueReadingTextId?: number | null;
            /** Format: date-time */
            lastActivityAt?: string | null;
        };
        FinishBookRequest: {
            /** Format: double */
            rating?: number | null;
        };
        Folder: {
            /** Format: int32 */
            folderId?: number;
            name: string;
            /** Format: int32 */
            parentFolderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
            color?: string | null;
            /** Format: uuid */
            userId?: string;
            /** Format: int32 */
            languageId?: number | null;
            /** Format: date-time */
            createdAt?: string;
            user?: components["schemas"]["User"];
            language?: components["schemas"]["Language"];
            parentFolder?: components["schemas"]["Folder"];
            childFolders?: components["schemas"]["Folder"][] | null;
            texts?: components["schemas"]["Text"][] | null;
            books?: components["schemas"]["Book"][] | null;
        };
        FolderDto: {
            /** Format: int32 */
            folderId?: number;
            name?: string | null;
            /** Format: int32 */
            parentFolderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
            color?: string | null;
            /** Format: int32 */
            languageId?: number | null;
            /** Format: date-time */
            createdAt?: string;
            /** Format: int32 */
            itemCount?: number;
        };
        /**
         * Format: int32
         * @enum {integer}
         */
        GoalMode: 1 | 2;
        GoalProgressDto: {
            /** Format: int32 */
            goalId?: number;
            /** Format: uuid */
            userId?: string;
            /** Format: int32 */
            languageId?: number | null;
            languageName?: string | null;
            goalType?: components["schemas"]["GoalType"];
            mode?: components["schemas"]["GoalMode"];
            recurrence?: components["schemas"]["GoalRecurrence"];
            /** Format: int64 */
            targetValue?: number;
            /** Format: int64 */
            baselineValue?: number;
            /** Format: int64 */
            progress?: number;
            /** Format: double */
            percentComplete?: number;
            /** Format: date */
            deadline?: string | null;
            /** Format: date */
            currentPeriodStart?: string | null;
            /** Format: date */
            currentPeriodEnd?: string | null;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            completedAt?: string | null;
            /** Format: date-time */
            archivedAt?: string | null;
            title?: string | null;
            state?: string | null;
            pace?: string | null;
            /** Format: int64 */
            expectedAtToday?: number | null;
            /** Format: int64 */
            remainingToTarget?: number | null;
            /** Format: date */
            inferredFinishOn?: string | null;
            lastClosedPeriod?: components["schemas"]["ClosedPeriodDto"];
        };
        /**
         * Format: int32
         * @enum {integer}
         */
        GoalRecurrence: 0 | 1 | 2;
        GoalSuggestionDto: {
            /** Format: int64 */
            suggestedTarget?: number;
            /** Format: int64 */
            currentMetric?: number;
            /** Format: int64 */
            last7DaysTotal?: number;
            /** Format: int64 */
            last30DaysTotal?: number;
        };
        /**
         * Format: int32
         * @enum {integer}
         */
        GoalType: 1 | 2 | 3;
        GradeDistributionDto: {
            /** Format: int32 */
            grade?: number;
            /** Format: int32 */
            count?: number;
        };
        HardcoverBookCandidate: {
            /** Format: int32 */
            bookId?: number;
            /** Format: int32 */
            editionId?: number | null;
            title?: string | null;
            slug?: string | null;
            description?: string | null;
            author?: string | null;
            isbn13?: string | null;
            publisher?: string | null;
            /** Format: date-time */
            releaseDate?: string | null;
            /** Format: int32 */
            pages?: number | null;
            imageUrl?: string | null;
            /** Format: double */
            score?: number;
        };
        HardcoverConnectionResult: {
            configured?: boolean;
            connected?: boolean;
            syncEnabled?: boolean;
            /** Format: int32 */
            hardcoverUserId?: number | null;
            username?: string | null;
            message?: string | null;
        };
        HardcoverMatchRequest: {
            /** Format: int32 */
            hardcoverBookId?: number | null;
        };
        HardcoverMatchResult: {
            applied?: boolean;
            appliedCandidate?: components["schemas"]["HardcoverBookCandidate"];
            candidates?: components["schemas"]["HardcoverBookCandidate"][] | null;
            message?: string | null;
        };
        HardcoverMetadataImportResult: {
            success?: boolean;
            updatedFields?: string[] | null;
            candidates?: components["schemas"]["HardcoverBookCandidate"][] | null;
            message?: string | null;
        };
        HardcoverProgressSyncResult: {
            /** Format: int32 */
            bookId?: number;
            success?: boolean;
            skipped?: boolean;
            /** Format: double */
            completionPercentage?: number;
            /** Format: int32 */
            statusId?: number | null;
            /** Format: int32 */
            progressPages?: number | null;
            message?: string | null;
        };
        HardcoverSyncAllResult: {
            results?: components["schemas"]["HardcoverProgressSyncResult"][] | null;
            message?: string | null;
        };
        Language: {
            /** Format: int32 */
            languageId?: number;
            name: string;
            code: string;
            /** Format: int32 */
            wordsRead?: number;
            showRomanization: boolean;
            rightToLeft: boolean;
            parserType: string;
            characterSubstitutions?: string | null;
            splitSentences: string;
            wordCharacters: string;
            isActiveForTranslation: boolean;
            deepLTargetCode?: string | null;
            geminiTargetCode?: string | null;
            books?: components["schemas"]["Book"][] | null;
            texts?: components["schemas"]["Text"][] | null;
            words?: components["schemas"]["Word"][] | null;
            dictionaries?: components["schemas"]["LanguageDictionary"][] | null;
            sentenceSplitExceptions?: components["schemas"]["LanguageSentenceSplitException"][] | null;
        };
        LanguageDictionary: {
            /** Format: int32 */
            dictionaryId?: number;
            /** Format: int32 */
            languageId: number;
            purpose: string;
            displayType: string;
            urlTemplate: string;
            isActive: boolean;
            /** Format: int32 */
            sortOrder: number;
        };
        LanguageInfo: {
            code?: string | null;
            name?: string | null;
        };
        LanguageListeningStat: {
            /** Format: int32 */
            languageId?: number;
            languageName?: string | null;
            /** Format: int32 */
            totalSeconds?: number;
        };
        LanguageReadingStat: {
            /** Format: int32 */
            languageId?: number;
            languageName?: string | null;
            /** Format: int32 */
            totalWords?: number;
        };
        LanguageSentenceSplitException: {
            /** Format: int32 */
            exceptionId?: number;
            /** Format: int32 */
            languageId: number;
            exceptionString: string;
        };
        LanguageStatisticsDto: {
            /** Format: int32 */
            languageId?: number;
            languageName?: string | null;
            languageCode?: string | null;
            /** Format: int32 */
            wordCount?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: int32 */
            totalWordsRead?: number;
            /** Format: int32 */
            totalTextsCompleted?: number;
            /** Format: int32 */
            totalSecondsListened?: number;
            /** Format: int32 */
            bookCount?: number;
            /** Format: int32 */
            finishedBookCount?: number;
            cefrLevel?: string | null;
            nextCefrLevel?: string | null;
            /** Format: int32 */
            knownWordsToNextLevel?: number;
            /** Format: int32 */
            bandProgressPercent?: number;
            isCefrApproximate?: boolean;
        };
        LeechCardDto: {
            /** Format: int32 */
            srsCardReviewId?: number;
            /** Format: int32 */
            wordId?: number;
            term?: string | null;
            translation?: string | null;
            /** Format: int32 */
            lapseCount?: number;
            /** Format: int32 */
            wordStatus?: number;
            /** Format: double */
            easeFactor?: number;
        };
        LibraryBookDto: {
            /** Format: int32 */
            bookId?: number;
            title?: string | null;
            description?: string | null;
            coverImagePath?: string | null;
            languageName?: string | null;
            /** Format: int32 */
            partCount?: number;
            /** Format: int32 */
            finishedPartCount?: number;
            /** Format: int32 */
            lastReadTextId?: number | null;
            /** Format: date-time */
            lastReadAt?: string | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
            isFinished?: boolean;
            /** Format: int32 */
            sortOrder?: number;
            /** Format: int32 */
            folderId?: number | null;
            tags?: string[] | null;
            /** Format: double */
            readonly completionPercentage?: number;
        };
        LibraryContentsDto: {
            currentFolder?: components["schemas"]["FolderDto"];
            breadcrumbs?: components["schemas"]["BreadcrumbDto"][] | null;
            folders?: components["schemas"]["FolderDto"][] | null;
            books?: components["schemas"]["LibraryBookDto"][] | null;
            texts?: components["schemas"]["LibraryTextDto"][] | null;
        };
        LibraryTextDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            languageName?: string | null;
            /** Format: date-time */
            createdAt?: string;
            tag?: string | null;
            isAudioLesson?: boolean;
            isFinished?: boolean;
            /** Format: int32 */
            sortOrder?: number;
            /** Format: int32 */
            folderId?: number | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
        };
        ListeningStatsDto: {
            /** Format: int32 */
            totalListeningSeconds?: number;
            listeningByDate?: {
                [key: string]: number;
            } | null;
            listeningByLanguage?: components["schemas"]["LanguageListeningStat"][] | null;
        };
        LogListeningRequest: {
            /** Format: int32 */
            languageId?: number;
            /** Format: int32 */
            durationSeconds?: number;
        };
        LogManualActivityRequest: {
            /** Format: int32 */
            languageId: number;
            /** Format: int32 */
            wordCount?: number | null;
            /** Format: int32 */
            listeningDurationSeconds?: number | null;
        };
        LogSentenceReadRequest: {
            /** Format: int32 */
            textId: number;
            segments?: components["schemas"]["SentenceSegmentDto"][] | null;
            /** Format: int32 */
            currentSegmentIndex?: number | null;
        };
        LoginRequest: {
            password?: string | null;
        };
        MoveItemsDto: {
            textIds?: number[] | null;
            bookIds?: number[] | null;
            folderIds?: number[] | null;
            /** Format: int32 */
            targetFolderId?: number | null;
        };
        NewTermDto: {
            term: string;
            translation?: string | null;
            /** Format: int32 */
            status?: number | null;
        };
        NextLessonDto: {
            /** Format: int32 */
            textId?: number | null;
        };
        OpenRouterTestResultDto: {
            success?: boolean;
            message?: string | null;
            details?: string | null;
        };
        ReaderContentBlock: {
            type?: string | null;
            text?: string | null;
            imageUrl?: string | null;
            altText?: string | null;
            caption?: string | null;
            meta?: {
                [key: string]: string;
            } | null;
        };
        ReadingStatsDto: {
            /** Format: int32 */
            totalWordsRead?: number;
            activityByDate?: {
                [key: string]: number;
            } | null;
            activityByLanguage?: components["schemas"]["LanguageReadingStat"][] | null;
        };
        RecentTextDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            languageName?: string | null;
            /** Format: date-time */
            lastAccessedAt?: string;
            isAudioLesson?: boolean;
            /** Format: int32 */
            bookId?: number | null;
            bookTitle?: string | null;
            /** Format: int32 */
            partNumber?: number | null;
        };
        ReorderItemDto: {
            /** Format: int32 */
            id?: number;
            type?: string | null;
            /** Format: int32 */
            sortOrder?: number;
        };
        ReorderItemsDto: {
            /** Format: int32 */
            folderId?: number | null;
            items?: components["schemas"]["ReorderItemDto"][] | null;
        };
        RetentionByStatusDto: {
            /** Format: int32 */
            status?: number;
            /** Format: int32 */
            totalReviews?: number;
            /** Format: int32 */
            goodReviews?: number;
            /** Format: double */
            retentionRate?: number;
        };
        ReviewsPerDayDto: {
            date?: string | null;
            /** Format: int32 */
            count?: number;
        };
        SelectionTranslationRequest: {
            selectedText?: string | null;
            sentenceContext?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        SelectionTranslationResponse: {
            selectedText?: string | null;
            sentenceContext?: string | null;
            translatedText?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        SentenceExplanationResponse: {
            originalText?: string | null;
            explanationText?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        SentenceProgressDto: {
            /** Format: int32 */
            textId?: number;
            creditedSegmentIndices?: number[] | null;
            /** Format: int32 */
            creditedWordCount?: number;
            /** Format: int32 */
            lastSegmentIndex?: number | null;
        };
        SentenceSegmentDto: {
            /** Format: int32 */
            segmentIndex: number;
            segmentText: string;
        };
        SentenceTranslationRequest: {
            text?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        SentenceTranslationResponse: {
            originalText?: string | null;
            translatedText?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        SetupRequest: {
            password?: string | null;
        };
        SrsAnalyticsDto: {
            retentionByStatus?: components["schemas"]["RetentionByStatusDto"][] | null;
            accuracyTrend?: components["schemas"]["AccuracyTrendDto"][] | null;
            gradeDistribution?: components["schemas"]["GradeDistributionDto"][] | null;
            reviewsPerDay?: components["schemas"]["ReviewsPerDayDto"][] | null;
            leechCards?: components["schemas"]["LeechCardDto"][] | null;
            /** Format: int32 */
            cardsMaturedThisWeek?: number;
            /** Format: int32 */
            totalReviewsLast30Days?: number;
            /** Format: double */
            avgReviewsPerDay?: number;
        };
        SrsCardPatchDto: {
            /** Format: int32 */
            flag?: number | null;
            tags?: string | null;
        };
        SrsDueCardDto: {
            /** Format: int32 */
            srsCardReviewId?: number;
            /** Format: int32 */
            wordId?: number;
            term?: string | null;
            translation?: string | null;
            /** Format: int32 */
            wordStatus?: number;
            /** Format: double */
            easeFactor?: number;
            /** Format: int32 */
            interval?: number;
            /** Format: int32 */
            repetitions?: number;
            isLearning?: boolean;
            /** Format: int32 */
            currentLearningStepIndex?: number;
            hasEverGraduated?: boolean;
            isSuspended?: boolean;
            /** Format: int32 */
            flag?: number;
            tags?: string | null;
            phrases?: components["schemas"]["SrsPhraseDto"][] | null;
            /** Format: int32 */
            unknownWordsInPhrase?: number;
        };
        SrsForecastDto: {
            date?: string | null;
            /** Format: int32 */
            count?: number;
        };
        SrsHeatmapDto: {
            date?: string | null;
            /** Format: int32 */
            reviewCount?: number;
        };
        SrsMicroContextDto: {
            /** Format: int32 */
            srsCardReviewId?: number;
            /** Format: int32 */
            wordId?: number;
            term?: string | null;
            translation?: string | null;
            context?: string | null;
            usedForm?: string | null;
            /** Format: int32 */
            wordStatus?: number;
        };
        SrsMineDto: {
            /** Format: int32 */
            wordId: number;
            sentence: string;
            /** Format: int32 */
            textId?: number | null;
            textTitle?: string | null;
        };
        SrsPhraseDto: {
            /** Format: int32 */
            srsPhraseId?: number;
            sentence?: string | null;
            textTitle?: string | null;
            /** Format: date-time */
            createdAt?: string;
        };
        SrsReviewLogDto: {
            /** Format: int32 */
            srsReviewLogId?: number;
            /** Format: int32 */
            srsCardReviewId?: number;
            /** Format: int32 */
            grade?: number;
            /** Format: date-time */
            reviewedAt?: string;
        };
        SrsReviewSubmitDto: {
            /** Format: int32 */
            srsCardReviewId: number;
            /** Format: int32 */
            grade: number;
        };
        SrsStatsDto: {
            /** Format: int32 */
            dueCount?: number;
            /** Format: int32 */
            reviewableCount?: number;
            /** Format: int32 */
            totalCards?: number;
            /** Format: int32 */
            newCards?: number;
            /** Format: int32 */
            learningCards?: number;
            /** Format: int32 */
            matureCards?: number;
            /** Format: int32 */
            totalPhrases?: number;
            /** Format: int32 */
            reviewedToday?: number;
            /** Format: int32 */
            maxNewCards?: number;
            /** Format: int32 */
            maxReviews?: number;
            /** Format: int32 */
            studiedNewCardsToday?: number;
            /** Format: int32 */
            studiedReviewsToday?: number;
            /** Format: int32 */
            currentStreak?: number;
            /** Format: int32 */
            longestStreak?: number;
            /** Format: double */
            retentionRate?: number;
        };
        SrsStoryGenerateRequest: {
            /** Format: int32 */
            languageId: number;
            /** Format: int32 */
            maxWords?: number;
            status?: string | null;
            cardType?: string | null;
        };
        SrsStoryGenerateResponse: {
            microContexts?: components["schemas"]["SrsMicroContextDto"][] | null;
            /** Format: int32 */
            textId?: number;
            languageCode?: string | null;
            /** Format: int32 */
            remainingNewBudget?: number;
            /** Format: int32 */
            remainingReviewBudget?: number;
        };
        SrsStoryListDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            languageName?: string | null;
            /** Format: date-time */
            createdAt?: string;
            contentPreview?: string | null;
        };
        StoryGenerationRequest: {
            prompt: string;
            language: string;
            level: string;
            /** Format: int32 */
            maxLength?: number;
        };
        StoryGenerationResponse: {
            generatedStory?: string | null;
        };
        SummarizationRequest: {
            text: string;
            sourceLanguageCode: string;
            targetLanguageCode: string;
            /** Format: int32 */
            maxSummaryWords?: number | null;
        };
        SummarizationResponse: {
            originalText?: string | null;
            summaryText?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        Tag: {
            /** Format: int32 */
            tagId?: number;
            name: string;
            bookTags?: components["schemas"]["BookTag"][] | null;
        };
        TagDto: {
            /** Format: int32 */
            tagId?: number;
            name?: string | null;
        };
        Text: {
            /** Format: int32 */
            textId?: number;
            title: string;
            content: string;
            structuredContent?: string | null;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            lastAccessedAt?: string | null;
            /** Format: int32 */
            partNumber?: number | null;
            tag?: string | null;
            /** Format: uuid */
            userId?: string;
            /** Format: int32 */
            languageId?: number;
            /** Format: int32 */
            bookId?: number | null;
            /** Format: int32 */
            folderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
            user?: components["schemas"]["User"];
            language?: components["schemas"]["Language"];
            book?: components["schemas"]["Book"];
            folder?: components["schemas"]["Folder"];
            textWords?: components["schemas"]["TextWord"][] | null;
            isAudioLesson?: boolean;
            audioFilePath?: string | null;
            srtContent?: string | null;
            isFinished?: boolean;
            /** Format: date-time */
            lastCompletedAt?: string | null;
            wordLinkingStatus?: string | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            wordLinkingTokenizerVersion?: number | null;
        };
        TextDetailDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            content?: string | null;
            languageName?: string | null;
            languageCode?: string | null;
            /** Format: int32 */
            languageId?: number;
            /** Format: int32 */
            bookId?: number | null;
            bookTitle?: string | null;
            /** Format: date-time */
            createdAt?: string;
            isAudioLesson?: boolean;
            audioFilePath?: string | null;
            srtContent?: string | null;
            hasSrtContent?: boolean;
            wordLinkingStatus?: string | null;
            structuredContent?: components["schemas"]["ReaderContentBlock"][] | null;
            words?: components["schemas"]["WordDto"][] | null;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
        };
        TextDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            languageName?: string | null;
            /** Format: date-time */
            createdAt?: string;
            tag?: string | null;
            isAudioLesson?: boolean;
            /** Format: int32 */
            bookId?: number | null;
            bookTitle?: string | null;
            isFinished?: boolean;
            /** Format: double */
            audioProgress?: number | null;
            /** Format: int32 */
            folderId?: number | null;
            /** Format: int32 */
            sortOrder?: number;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
        };
        TextPartDto: {
            /** Format: int32 */
            textId?: number;
            title?: string | null;
            /** Format: int32 */
            partNumber?: number;
            /** Format: date-time */
            createdAt?: string;
            isFinished?: boolean;
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: date-time */
            statsUpdatedAt?: string | null;
            /** Format: int32 */
            readonly unknownWords?: number;
            /** Format: double */
            readonly unknownWordPercentage?: number | null;
        };
        TextStatsDto: {
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: double */
            completionPercentage?: number;
        };
        TextWord: {
            /** Format: int32 */
            textWordId?: number;
            /** Format: int32 */
            textId?: number;
            /** Format: int32 */
            wordId?: number;
            /** Format: int32 */
            occurrenceCount?: number;
            /** Format: date-time */
            createdAt?: string;
            text?: components["schemas"]["Text"];
            word?: components["schemas"]["Word"];
        };
        TranslationRequest: {
            text?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        TranslationResponse: {
            originalText?: string | null;
            translatedText?: string | null;
            sourceLanguageCode?: string | null;
            targetLanguageCode?: string | null;
        };
        UpdateAudioLessonProgressRequest: {
            /** Format: int32 */
            textId: number;
            /** Format: double */
            currentPosition?: number | null;
        };
        UpdateAudiobookProgressDto: {
            /** Format: int32 */
            currentAudiobookTrackId?: number | null;
            /** Format: double */
            currentAudiobookPosition?: number | null;
        };
        UpdateAudiobookProgressRequest: {
            /** Format: int32 */
            bookId: number;
            /** Format: int32 */
            currentAudiobookTrackId?: number | null;
            /** Format: double */
            currentAudiobookPosition?: number | null;
        };
        UpdateBookDto: {
            title: string;
            description?: string | null;
            tags?: string[] | null;
        };
        UpdateFolderDto: {
            name?: string | null;
            color?: string | null;
            /** Format: int32 */
            parentFolderId?: number | null;
        };
        UpdateGoalDto: {
            goalType?: components["schemas"]["GoalType"];
            mode?: components["schemas"]["GoalMode"];
            recurrence?: components["schemas"]["GoalRecurrence"];
            /** Format: int32 */
            languageId?: number | null;
            /** Format: int64 */
            targetValue?: number | null;
            /** Format: date */
            deadline?: string | null;
            clearDeadline?: boolean | null;
            title?: string | null;
        };
        UpdateLastReadDto: {
            /** Format: int32 */
            textId: number;
        };
        UpdateTextDto: {
            /** Format: int32 */
            textId: number;
            title: string;
            content: string;
            /** Format: int32 */
            languageId?: number | null;
            tag?: string | null;
        };
        UpdateUserSettingsDto: {
            theme?: string | null;
            /** Format: int32 */
            textSize?: number | null;
            textFont?: string | null;
            readingUiMode?: string | null;
            /** Format: int32 */
            readerContentWidth?: number | null;
            readingDensity?: string | null;
            /** Format: double */
            lineSpacing?: number | null;
            showWordInfoPanel?: boolean | null;
            tooltipOnlyForSavedWords?: boolean | null;
            readerParagraphIndent?: boolean | null;
            readerTextAlignment?: string | null;
            /** Format: int32 */
            leftPanelWidth?: number | null;
            autoTranslateWords?: boolean | null;
            autoTranslateOnOpen?: boolean | null;
            pauseOnWordClick?: boolean | null;
            highlightKnownWords?: boolean | null;
            sentenceMode?: boolean | null;
            /** Format: int32 */
            sentenceAudioRepeats?: number | null;
            sentenceTtsEnabled?: boolean | null;
            /** Format: double */
            sentenceTtsRate?: number | null;
            /** Format: int32 */
            defaultLanguageId?: number | null;
            translationTargetLanguageCode?: string | null;
            autoAdvanceToNextLesson?: boolean | null;
            autoMoveFinishedLessons?: boolean | null;
            showProgressStats?: boolean | null;
            showDesktopLessonControls?: boolean | null;
            discordWeeklyReportEnabled?: boolean | null;
            discordWebhookUrl?: string | null;
            discordWeeklyReportDayOfWeek?: string | null;
            /** Format: int32 */
            discordWeeklyReportHourLocal?: number | null;
            /** Format: int32 */
            discordTimezoneOffsetMinutes?: number | null;
            hardcoverSyncEnabled?: boolean | null;
            hardcoverApiToken?: string | null;
            clearHardcoverApiToken?: boolean | null;
            useOpenRouter?: boolean | null;
            openRouterApiKey?: string | null;
            openRouterModel?: string | null;
            openRouterReasoningEnabled?: boolean | null;
            openRouterReasoningEffort?: string | null;
            openRouterStoryReasoningEnabled?: boolean | null;
            openRouterStoryReasoningEffort?: string | null;
            openRouterTranslationModel?: string | null;
            openRouterExplanationModel?: string | null;
            openRouterStoryModel?: string | null;
            openRouterSummarizationModel?: string | null;
            customTranslationPrompt?: string | null;
            customExplanationPrompt?: string | null;
            customStoryPrompt?: string | null;
            customSummarizationPrompt?: string | null;
            /** Format: int32 */
            srsMaxNewCards?: number | null;
            /** Format: int32 */
            srsMaxReviews?: number | null;
            srsReviewOrder?: string | null;
            srsLearningStepMinutes?: string | null;
            /** Format: int32 */
            srsMaxIntervalDays?: number | null;
            /** Format: int32 */
            srsLapseMinimumIntervalDays?: number | null;
        };
        UpdateWordDto: {
            /** Format: int32 */
            status: number;
            translation?: string | null;
        };
        User: {
            /** Format: uuid */
            id?: string;
            userName?: string | null;
            normalizedUserName?: string | null;
            email?: string | null;
            normalizedEmail?: string | null;
            emailConfirmed?: boolean;
            passwordHash?: string | null;
            securityStamp?: string | null;
            concurrencyStamp?: string | null;
            phoneNumber?: string | null;
            phoneNumberConfirmed?: boolean;
            twoFactorEnabled?: boolean;
            /** Format: date-time */
            lockoutEnd?: string | null;
            lockoutEnabled?: boolean;
            /** Format: int32 */
            accessFailedCount?: number;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            lastLogin?: string | null;
            texts?: components["schemas"]["Text"][] | null;
            words?: components["schemas"]["Word"][] | null;
            books?: components["schemas"]["Book"][] | null;
            settings?: components["schemas"]["UserSettings"];
        };
        UserSettings: {
            /** Format: uuid */
            userId?: string;
            theme?: string | null;
            /** Format: int32 */
            textSize?: number;
            textFont?: string | null;
            readingUiMode?: string | null;
            /** Format: int32 */
            readerContentWidth?: number;
            readingDensity?: string | null;
            /** Format: double */
            lineSpacing?: number;
            showWordInfoPanel?: boolean;
            tooltipOnlyForSavedWords?: boolean;
            readerParagraphIndent?: boolean;
            readerTextAlignment?: string | null;
            /** Format: int32 */
            leftPanelWidth?: number;
            autoTranslateWords?: boolean;
            autoTranslateOnOpen?: boolean;
            pauseOnWordClick?: boolean;
            highlightKnownWords?: boolean;
            sentenceMode?: boolean;
            /** Format: int32 */
            sentenceAudioRepeats?: number;
            sentenceTtsEnabled?: boolean;
            /** Format: double */
            sentenceTtsRate?: number;
            /** Format: int32 */
            defaultLanguageId?: number;
            translationTargetLanguageCode?: string | null;
            autoAdvanceToNextLesson?: boolean;
            showProgressStats?: boolean;
            autoMoveFinishedLessons?: boolean;
            showDesktopLessonControls?: boolean;
            /** Format: int32 */
            currentAudiobookTrackId?: number | null;
            /** Format: double */
            currentAudiobookPosition?: number | null;
            discordWeeklyReportEnabled?: boolean;
            discordWebhookUrl?: string | null;
            discordWeeklyReportDayOfWeek?: string | null;
            /** Format: int32 */
            discordWeeklyReportHourLocal?: number;
            /** Format: int32 */
            discordTimezoneOffsetMinutes?: number;
            /** Format: date-time */
            discordWeeklyReportLastSentAt?: string | null;
            hardcoverSyncEnabled?: boolean;
            hardcoverApiToken?: string | null;
            /** Format: date-time */
            hardcoverLastSyncAt?: string | null;
            useOpenRouter?: boolean;
            openRouterApiKey?: string | null;
            openRouterModel?: string | null;
            openRouterReasoningEnabled?: boolean;
            openRouterReasoningEffort?: string | null;
            openRouterStoryReasoningEnabled?: boolean;
            openRouterStoryReasoningEffort?: string | null;
            openRouterTranslationModel?: string | null;
            openRouterExplanationModel?: string | null;
            openRouterStoryModel?: string | null;
            openRouterSummarizationModel?: string | null;
            customTranslationPrompt?: string | null;
            customExplanationPrompt?: string | null;
            customStoryPrompt?: string | null;
            customSummarizationPrompt?: string | null;
            /** Format: int32 */
            srsMaxNewCards?: number;
            /** Format: int32 */
            srsMaxReviews?: number;
            srsReviewOrder?: string | null;
            /** Format: date-time */
            srsDailyStudyDate?: string | null;
            /** Format: int32 */
            srsDailyNewCardsStudied?: number;
            /** Format: int32 */
            srsDailyReviewsStudied?: number;
            srsLearningStepMinutes?: string | null;
            /** Format: int32 */
            srsMaxIntervalDays?: number;
            /** Format: int32 */
            srsLapseMinimumIntervalDays?: number;
            /** Format: int32 */
            srsCurrentStreak?: number;
            /** Format: int32 */
            srsLongestStreak?: number;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            updatedAt?: string | null;
            user?: components["schemas"]["User"];
        };
        UserSettingsDto: {
            theme?: string | null;
            /** Format: int32 */
            textSize?: number;
            textFont?: string | null;
            readingUiMode?: string | null;
            /** Format: int32 */
            readerContentWidth?: number;
            readingDensity?: string | null;
            /** Format: double */
            lineSpacing?: number;
            showWordInfoPanel?: boolean;
            tooltipOnlyForSavedWords?: boolean;
            readerParagraphIndent?: boolean;
            readerTextAlignment?: string | null;
            /** Format: int32 */
            leftPanelWidth?: number;
            autoTranslateWords?: boolean;
            autoTranslateOnOpen?: boolean;
            pauseOnWordClick?: boolean;
            highlightKnownWords?: boolean;
            sentenceMode?: boolean;
            /** Format: int32 */
            sentenceAudioRepeats?: number;
            sentenceTtsEnabled?: boolean;
            /** Format: double */
            sentenceTtsRate?: number;
            /** Format: int32 */
            defaultLanguageId?: number;
            translationTargetLanguageCode?: string | null;
            autoAdvanceToNextLesson?: boolean;
            autoMoveFinishedLessons?: boolean;
            showProgressStats?: boolean;
            showDesktopLessonControls?: boolean;
            /** Format: int32 */
            currentAudiobookTrackId?: number | null;
            /** Format: double */
            currentAudiobookPosition?: number | null;
            discordWeeklyReportEnabled?: boolean;
            discordWebhookUrl?: string | null;
            discordWeeklyReportDayOfWeek?: string | null;
            /** Format: int32 */
            discordWeeklyReportHourLocal?: number;
            /** Format: int32 */
            discordTimezoneOffsetMinutes?: number;
            hardcoverSyncEnabled?: boolean;
            hasHardcoverApiToken?: boolean;
            /** Format: date-time */
            hardcoverLastSyncAt?: string | null;
            useOpenRouter?: boolean;
            openRouterApiKey?: string | null;
            openRouterModel?: string | null;
            openRouterReasoningEnabled?: boolean;
            openRouterReasoningEffort?: string | null;
            openRouterStoryReasoningEnabled?: boolean;
            openRouterStoryReasoningEffort?: string | null;
            openRouterTranslationModel?: string | null;
            openRouterExplanationModel?: string | null;
            openRouterStoryModel?: string | null;
            openRouterSummarizationModel?: string | null;
            customTranslationPrompt?: string | null;
            customExplanationPrompt?: string | null;
            customStoryPrompt?: string | null;
            customSummarizationPrompt?: string | null;
            /** Format: int32 */
            srsMaxNewCards?: number;
            /** Format: int32 */
            srsMaxReviews?: number;
            srsReviewOrder?: string | null;
            srsLearningStepMinutes?: string | null;
            /** Format: int32 */
            srsMaxIntervalDays?: number;
            /** Format: int32 */
            srsLapseMinimumIntervalDays?: number;
        };
        UserStatisticsDto: {
            /** Format: int32 */
            totalWords?: number;
            /** Format: int32 */
            knownWords?: number;
            /** Format: int32 */
            learningWords?: number;
            /** Format: int32 */
            totalBooks?: number;
            /** Format: int32 */
            finishedBooks?: number;
            /** Format: date-time */
            lastActivity?: string;
            /** Format: int32 */
            totalLanguages?: number;
            languageStatistics?: components["schemas"]["LanguageStatisticsDto"][] | null;
        };
        Word: {
            /** Format: int32 */
            wordId?: number;
            term: string;
            /** Format: int32 */
            status: number;
            /** Format: date-time */
            createdAt?: string;
            /** Format: int32 */
            languageId?: number;
            /** Format: uuid */
            userId?: string;
            language?: components["schemas"]["Language"];
            user?: components["schemas"]["User"];
            translation?: components["schemas"]["WordTranslation"];
            textWords?: components["schemas"]["TextWord"][] | null;
        };
        WordDto: {
            /** Format: int32 */
            wordId?: number;
            term?: string | null;
            /** Format: int32 */
            status?: number;
            translation?: string | null;
            isNew?: boolean;
        };
        WordResponseDto: {
            /** Format: int32 */
            wordId?: number;
            term?: string | null;
            /** Format: int32 */
            status?: number;
            translation?: string | null;
            isNew?: boolean;
            /** Format: date-time */
            createdAt?: string;
        };
        WordResponseDtoPagedResult: {
            items: components["schemas"]["WordResponseDto"][] | null;
            /** Format: int32 */
            totalCount?: number;
            /** Format: int32 */
            pageNumber?: number;
            /** Format: int32 */
            pageSize?: number;
            /** Format: int32 */
            totalPages?: number;
        };
        WordTranslation: {
            /** Format: int32 */
            wordId?: number;
            translation: string;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            updatedAt?: string | null;
            word?: components["schemas"]["Word"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
