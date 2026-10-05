namespace Loupedeck.AutoIngestMxCsDevPlugin.Transport
{
    using System.Collections.Generic;
    using System.Text.Json.Serialization;

    // Mirrors AutoIngestCommands.getState()'s shape — see docs/commandLayer.md.
    // Every field below is OPTIONAL except the five Phase 1A ones (context
    // through availableCommands), which AutoIngest always sends once a real
    // window has loaded. System.Text.Json silently ignores any JSON property
    // with no matching C# property — a future state field AutoIngest adds
    // never breaks deserialization here (step 12's "unknown future JSON fields
    // should not break the C# client" is satisfied by .NET's own default
    // behavior, not special-cased code).

    public sealed class GroupInfo
    {
        [JsonPropertyName("id")] public int Id { get; set; }
        [JsonPropertyName("label")] public string Label { get; set; }
        [JsonPropertyName("fileCount")] public int FileCount { get; set; }
        [JsonPropertyName("colorIndex")] public int ColorIndex { get; set; }
        // subEventId's real type varies (string | null | other) — kept as the
        // raw element rather than guessing a .NET type, matching "do not
        // require every optional field" for a field this plugin never reads
        // beyond passing through for display.
        [JsonPropertyName("subEventId")] public System.Text.Json.JsonElement SubEventId { get; set; }
    }

    public sealed class SequenceInfo
    {
        [JsonPropertyName("code")] public string Code { get; set; }
        [JsonPropertyName("count")] public int Count { get; set; }
    }

    public sealed class TagInfo
    {
        [JsonPropertyName("id")] public string Id { get; set; } // "<category>:<label>" — see docs/commandLayer.md
        [JsonPropertyName("category")] public string Category { get; set; }
        [JsonPropertyName("label")] public string Label { get; set; }
        [JsonPropertyName("state")] public string State { get; set; } // "checked" | "unchecked" | "indeterminate"
    }

    public sealed class TagRefinementInfo
    {
        [JsonPropertyName("active")] public bool Active { get; set; }
        [JsonPropertyName("scopeLabel")] public string ScopeLabel { get; set; }
        [JsonPropertyName("componentLabel")] public string ComponentLabel { get; set; }
        [JsonPropertyName("selectedCount")] public int SelectedCount { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("tags")] public List<TagInfo> Tags { get; set; }
    }

    public sealed class EventInfo
    {
        [JsonPropertyName("activeEventName")] public string ActiveEventName { get; set; }
        [JsonPropertyName("participatingCount")] public int ParticipatingCount { get; set; }
    }

    public sealed class AutoIngestState
    {
        [JsonPropertyName("context")] public string Context { get; set; } // "browse" | "qmz" | "import"
        [JsonPropertyName("activeFile")] public string ActiveFile { get; set; }
        [JsonPropertyName("selectedCount")] public int SelectedCount { get; set; }
        [JsonPropertyName("hasSelection")] public bool HasSelection { get; set; }
        [JsonPropertyName("previewOpen")] public bool PreviewOpen { get; set; }
        [JsonPropertyName("availableCommands")] public List<string> AvailableCommands { get; set; } = new();
        [JsonPropertyName("groups")] public List<GroupInfo> Groups { get; set; }
        [JsonPropertyName("sequences")] public List<SequenceInfo> Sequences { get; set; }
        [JsonPropertyName("tagRefinement")] public TagRefinementInfo TagRefinement { get; set; }
        [JsonPropertyName("event")] public EventInfo Event { get; set; }
    }

    public enum ConnectionState
    {
        Disconnected,
        Discovering,
        Connecting,
        Authenticating,
        Connected,
    }

    public sealed record CommandResult(
        bool Ok,
        string CommandId = null,
        bool? Executed = null,
        System.Text.Json.JsonElement? Detail = null,
        string Reason = null);

    public sealed record ClientSnapshot(ConnectionState ConnectionState, AutoIngestState State);
}
