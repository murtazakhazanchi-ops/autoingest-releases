namespace Loupedeck.AutoIngestMxCsDevPlugin.Tests
{
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AutoIngestMxCsDevPlugin.Transport;
    using Xunit;

    /// <summary>
    /// Phase 4B — tests for the pure, Logitech-free refinement-workspace
    /// model (RefinementWorkspaceModel). Uses state fixtures shaped exactly
    /// like AutoIngestState.cs's own TagRefinementInfo/TagInfo (which itself
    /// mirrors the real wire protocol — see Transport/AutoIngestState.cs's
    /// own doc comment) — never a hand-invented shape.
    /// </summary>
    public class RefinementWorkspaceModelTests
    {
        private static TagInfo Tag(string category, string label, string state) =>
            new() { Id = $"{category}:{label}", Category = category, Label = label, State = state };

        private static TagRefinementInfo Info(params TagInfo[] tags) => new()
        {
            Active = true,
            ScopeLabel = "G1",
            ComponentLabel = "Waaz",
            SelectedCount = 2,
            Status = "mixed",
            Tags = tags.ToList(),
        };

        // ── State → dynamic tag list mapping ────────────────────────────────

        [Fact]
        public void BuildButtonSpecs_MapsEveryTagInOrder()
        {
            var info = Info(
                Tag("eventTypes", "Waaz", "checked"),
                Tag("eventTypes", "Majlis", "unchecked"),
                Tag("additionalKeywords", "Hall A", "indeterminate"));

            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, availableCommands: System.Array.Empty<string>());

            var tagSpecs = specs.Where(s => s.Kind == RefinementButtonKind.Tag).ToList();
            Assert.Equal(3, tagSpecs.Count);
            // Tag order stability — never resorted from AutoIngest's own array order.
            Assert.Equal(new[] { "Waaz", "Majlis", "Hall A" }, tagSpecs.Select(s => s.Label));
        }

        [Fact]
        public void BuildButtonSpecs_InactiveOrNullRefinement_ReturnsSingleUnavailableEntry()
        {
            // Changed after physical testing: a reactive Close() from
            // RefineTagsFolder's background state-subscription callback
            // produced a real zombie-session bug (see that class's own doc
            // comment) — an empty list isn't returned anymore; a single
            // informational, inert "Unavailable" entry is, so the operator
            // sees a clear state and exits via the real hardware Back button.
            foreach (var tagRefinement in new[] { null, new TagRefinementInfo { Active = false } })
            {
                var specs = RefinementWorkspaceModel.BuildButtonSpecs(tagRefinement, System.Array.Empty<string>());
                var spec = Assert.Single(specs);
                Assert.Equal(RefinementButtonKind.Unavailable, spec.Kind);
                Assert.Equal(RefinementWorkspaceModel.UnavailableActionParameter, spec.ActionParameter);
                Assert.True(RefinementWorkspaceModel.IsControlAction(spec.ActionParameter));
            }
        }

        // ── Canonical tag identity — passthrough, never array position ─────

        [Fact]
        public void TagActionParameter_IsTheRealCanonicalIdUnmodified()
        {
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, System.Array.Empty<string>());
            Assert.Equal("eventTypes:Waaz", specs.Single().ActionParameter);
        }

        [Fact]
        public void ControlActionParameters_NeverCollideWithARealTagId()
        {
            // Every real tag id starts with "eventTypes:" or "additionalKeywords:" —
            // the sentinels deliberately do not, so IsControlAction never
            // misclassifies a real tag as a control button or vice versa.
            Assert.False(RefinementWorkspaceModel.IsControlAction("eventTypes:Waaz"));
            Assert.False(RefinementWorkspaceModel.IsControlAction("additionalKeywords:Hall A"));
            Assert.True(RefinementWorkspaceModel.IsControlAction(RefinementWorkspaceModel.ApplyActionParameter));
            Assert.True(RefinementWorkspaceModel.IsControlAction(RefinementWorkspaceModel.AllTagsActionParameter));
            Assert.True(RefinementWorkspaceModel.IsControlAction(RefinementWorkspaceModel.ResetTagsActionParameter));
            Assert.True(RefinementWorkspaceModel.IsControlAction(RefinementWorkspaceModel.SelectActionParameter));
            Assert.True(RefinementWorkspaceModel.IsControlAction(RefinementWorkspaceModel.ClearSelectionActionParameter));
        }

        [Fact]
        public void SelectAndClearButtons_RestoreTheProvenInWorkspaceSelectionWorkflow()
        {
            // Regression test for the real physical-testing finding: entering
            // refinement mode clears the outer selection (pre-existing
            // AutoIngest behavior), and the dynamic folder replaces the whole
            // Keypad grid including the normal SELECT key — so without these
            // two buttons there was no way to attach any file to the
            // refinement scope at all once inside the folder.
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, new[] { "selection.toggleCurrent", "selection.clear" });

            var select = Assert.Single(specs, s => s.Kind == RefinementButtonKind.SelectCurrent);
            Assert.Equal(RefinementWorkspaceModel.SelectActionParameter, select.ActionParameter);
            Assert.Equal("Select", select.Label);

            var clear = Assert.Single(specs, s => s.Kind == RefinementButtonKind.ClearFileSelection);
            Assert.Equal(RefinementWorkspaceModel.ClearSelectionActionParameter, clear.ActionParameter);
            Assert.Equal("Clear", clear.Label);
        }

        [Fact]
        public void DuplicateLabelsInDifferentCategories_RemainDistinctIdentities()
        {
            var info = Info(
                Tag("eventTypes", "Waaz", "checked"),
                Tag("additionalKeywords", "Waaz", "unchecked"));

            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, System.Array.Empty<string>());
            var parameters = specs.Select(s => s.ActionParameter).ToList();
            Assert.Equal(2, parameters.Distinct().Count()); // "eventTypes:Waaz" != "additionalKeywords:Waaz"
        }

        // ── Checked / unchecked / indeterminate rendering input ─────────────

        [Theory]
        [InlineData("checked")]
        [InlineData("unchecked")]
        [InlineData("indeterminate")]
        public void BuildButtonSpecs_PreservesRealStateValueUnmodified(string state)
        {
            var info = Info(Tag("eventTypes", "Waaz", state));
            var spec = RefinementWorkspaceModel.BuildButtonSpecs(info, System.Array.Empty<string>()).Single();
            Assert.Equal(state, spec.State);
        }

        // ── UI-equivalent next-state calculation (brief §9's transition table) ──

        [Theory]
        [InlineData("unchecked", true)]      // unchecked -> checked
        [InlineData("indeterminate", true)]  // indeterminate -> checked (native-checkbox-click equivalent, NOT a 3-way cycle)
        [InlineData("checked", false)]       // checked -> unchecked
        public void ComputeNextChecked_MatchesRealUiTransitionTable(string currentState, bool expectedNextChecked)
        {
            Assert.Equal(expectedNextChecked, RefinementWorkspaceModel.ComputeNextChecked(currentState));
        }

        // ── Stale tag rejection ──────────────────────────────────────────────

        [Fact]
        public void ResolveTag_UnknownId_ReturnsNull()
        {
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            Assert.Null(RefinementWorkspaceModel.ResolveTag(info, "eventTypes:DoesNotExist"));
        }

        [Fact]
        public void ResolveTag_StaleIdFromPreviousScope_ReturnsNull()
        {
            // Simulates brief §19: Change Event replaced the tag set entirely —
            // an id that was valid a moment ago must now resolve to null.
            var oldInfo = Info(Tag("eventTypes", "Waaz", "checked"));
            var newInfo = Info(Tag("eventTypes", "Ziyarat", "unchecked"));
            var pressedId = RefinementWorkspaceModel.BuildButtonSpecs(oldInfo, System.Array.Empty<string>()).Single().ActionParameter;

            Assert.Null(RefinementWorkspaceModel.ResolveTag(newInfo, pressedId));
        }

        [Fact]
        public void ResolveTag_NullRefinement_ReturnsNull()
        {
            Assert.Null(RefinementWorkspaceModel.ResolveTag(null, "eventTypes:Waaz"));
        }

        // ── Tag-list replacement on new state ───────────────────────────────

        [Fact]
        public void BuildButtonSpecs_NewStateFullyReplacesOldTagSet()
        {
            var info1 = Info(Tag("eventTypes", "Waaz", "checked"), Tag("eventTypes", "Majlis", "unchecked"));
            var info2 = Info(Tag("eventTypes", "Ziyarat", "checked"));

            var specs1 = RefinementWorkspaceModel.BuildButtonSpecs(info1, System.Array.Empty<string>());
            var specs2 = RefinementWorkspaceModel.BuildButtonSpecs(info2, System.Array.Empty<string>());

            Assert.Equal(2, specs1.Count(s => s.Kind == RefinementButtonKind.Tag));
            Assert.Single(specs2, s => s.Kind == RefinementButtonKind.Tag);
            Assert.DoesNotContain(specs2, s => s.Label == "Waaz" || s.Label == "Majlis");
        }

        // ── Apply / All Tags / Reset Tags availability (availableCommands-gated) ──

        [Theory]
        [InlineData("tagRefinement.applyToSelected", RefinementButtonKind.ApplyToSelected, "Apply")]
        [InlineData("tagRefinement.useAllTags", RefinementButtonKind.UseAllTags, "All Tags")]
        [InlineData("tagRefinement.clearSelected", RefinementButtonKind.ClearSelected, "Reset Tags")]
        [InlineData("selection.toggleCurrent", RefinementButtonKind.SelectCurrent, "Select")]
        [InlineData("selection.clear", RefinementButtonKind.ClearFileSelection, "Clear")]
        public void ControlButton_OnlyAppearsWhenItsCommandIsAvailable(string commandId, RefinementButtonKind kind, string expectedLabel)
        {
            var info = Info(Tag("eventTypes", "Waaz", "checked"));

            var withoutCommand = RefinementWorkspaceModel.BuildButtonSpecs(info, System.Array.Empty<string>());
            Assert.DoesNotContain(withoutCommand, s => s.Kind == kind);

            var withCommand = RefinementWorkspaceModel.BuildButtonSpecs(info, new[] { commandId });
            var spec = Assert.Single(withCommand, s => s.Kind == kind);
            Assert.Equal(expectedLabel, spec.Label);
        }

        [Fact]
        public void ResetTagsLabel_IsNotMislabeledAsClearOrNoTags()
        {
            // Verified against the real implementation (renderer.js's
            // _resetRefinementSelectionToDefault, #rpResetBtn) before writing
            // this: clearSelected reverts to the component's inherited
            // defaults, which may still leave tags checked — it is NOT
            // "no tags"/"clear all". This test pins the correct wording so a
            // future edit can't silently reintroduce the wrong label.
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, new[] { "tagRefinement.clearSelected" });
            var resetSpec = specs.Single(s => s.Kind == RefinementButtonKind.ClearSelected);
            Assert.DoesNotContain("Clear", resetSpec.Label);
            Assert.DoesNotContain("No Tags", resetSpec.Label);
            Assert.Equal("Reset Tags", resetSpec.Label);
        }

        [Fact]
        public void ButtonOrder_SelectClearFirstThenTagsThenAllTagsThenResetThenApply()
        {
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            var commands = new[]
            {
                "selection.toggleCurrent", "selection.clear",
                "tagRefinement.useAllTags", "tagRefinement.clearSelected", "tagRefinement.applyToSelected",
            };
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, commands);

            Assert.Equal(
                new[]
                {
                    RefinementButtonKind.SelectCurrent, RefinementButtonKind.ClearFileSelection,
                    RefinementButtonKind.Tag,
                    RefinementButtonKind.UseAllTags, RefinementButtonKind.ClearSelected, RefinementButtonKind.ApplyToSelected,
                },
                specs.Select(s => s.Kind));
        }

        // ── Disconnected/offline handling ───────────────────────────────────

        [Fact]
        public void BuildButtonSpecs_NullAvailableCommands_NeverThrows()
        {
            var info = Info(Tag("eventTypes", "Waaz", "checked"));
            var specs = RefinementWorkspaceModel.BuildButtonSpecs(info, availableCommands: null);
            Assert.Single(specs); // the one tag — no control buttons without any availableCommands
        }

        // ── Long labels ──────────────────────────────────────────────────────

        [Fact]
        public void TruncateForDisplay_ShortLabel_PassesThroughUnmodified()
        {
            Assert.Equal("Waaz", RefinementWorkspaceModel.TruncateForDisplay("Waaz", canvasWidthPixels: 90));
        }

        [Fact]
        public void TruncateForDisplay_LongLabel_IsShortenedNeverReplacedWithAPlaceholder()
        {
            var longLabel = "A Very Long Tag Name That Will Never Fit On A Tiny Keypad LCD Screen";
            var result = RefinementWorkspaceModel.TruncateForDisplay(longLabel, canvasWidthPixels: 60);

            Assert.True(result.Length < longLabel.Length);
            Assert.StartsWith("A Very", result); // real text preserved, not "Tag 1" — exact cutoff shifts with the measured px/char constant, not pinned here
            Assert.DoesNotContain("Tag 1", result);
            Assert.EndsWith("…", result);
        }

        [Fact]
        public void TruncateForDisplay_NullOrEmpty_HandledSafely()
        {
            Assert.Null(RefinementWorkspaceModel.TruncateForDisplay(null, 90));
            Assert.Equal(string.Empty, RefinementWorkspaceModel.TruncateForDisplay(string.Empty, 90));
        }

        // Pins the real physical-closure finding (brief §14): a label with no
        // whitespace gets no wrap point from BitmapBuilder.DrawText, so it
        // must be truncated to ONE line's worth of budget, not two — found by
        // physically overflowing the LCD key with a synthetic hyphenated
        // label, confirmed by rendering and visually inspecting the clipped
        // output (see RefinementWorkspaceModel.TruncateForDisplay's own doc
        // comment for the measured constants). 80px is this SDK's real
        // Width90 button canvas width (confirmed via reflection — NOT the
        // nominal "90").
        [Fact]
        public void TruncateForDisplay_LongLabelWithNoWrapPoint_TruncatesToOneLineBudget()
        {
            var longUnbrokenLabel = "TestTag01-ThisIsADeliberatelyVeryLongAdditionalKeywordLabel";
            var result = RefinementWorkspaceModel.TruncateForDisplay(longUnbrokenLabel, canvasWidthPixels: 80);

            Assert.True(result.Length < longUnbrokenLabel.Length);
            // One line's worth at 80px / ~9.3px-per-char is ~8 chars — must
            // stay far short of the old (broken) 2-line budget of ~22 chars,
            // which is what physically overflowed on the real device.
            Assert.True(result.Length <= 10, $"expected a single-line-budget truncation, got \"{result}\" ({result.Length} chars)");
            Assert.StartsWith("Test", result); // exact cutoff shifts with the measured px/char constant, not pinned here
            Assert.EndsWith("…", result);
        }

        // A label WITH a real wrap point must still get the full two-line
        // budget — DrawText wraps it correctly (confirmed by rendering), so
        // truncating it as aggressively as an unbroken label would needlessly
        // shorten text that actually fits fine.
        [Fact]
        public void TruncateForDisplay_LabelWithUsableWrapPoint_StillGetsTwoLineBudget()
        {
            var result = RefinementWorkspaceModel.TruncateForDisplay("Test Tag One", canvasWidthPixels: 80);
            Assert.Equal("Test Tag One", result); // fits within the 2-line budget — passes through unmodified
        }

        // Pins the real physical-closure finding from Phase 4C (revised)'s
        // GROUPS/MAP GROUP testing: a real component folder name
        // ("01-Ziyarat-Mawkib-Mazar e Saifee") DOES contain a space, but not
        // until index 23 — past where a naive two-line-budget cutoff landed
        // (15 chars), producing a truncated result with NO space in it at
        // all and overflowing on the real device exactly like the original,
        // unbroken-label bug. Confirmed by rendering the actual truncated
        // output and visually inspecting it. A wrap point only "counts" when
        // it occurs at or before the single-line budget — otherwise the
        // label's own first word is already too long for one line, so a
        // bigger overall budget cannot help and must not be granted.
        [Fact]
        public void TruncateForDisplay_WrapPointPastSingleLineBudget_FallsBackToOneLineBudget()
        {
            var realComponentFolderName = "01-Ziyarat-Mawkib-Mazar e Saifee"; // first space at index 23
            var result = RefinementWorkspaceModel.TruncateForDisplay(realComponentFolderName, canvasWidthPixels: 80);

            Assert.True(result.Length <= 10, $"expected a single-line-budget truncation, got \"{result}\" ({result.Length} chars)");
            Assert.DoesNotContain(" ", result); // the truncated result must never pretend to have a wrap point it doesn't
            Assert.EndsWith("…", result);
        }

        // The inverse case: a space EARLY enough to survive truncation still
        // grants the larger budget, and the result legitimately contains it.
        [Fact]
        public void TruncateForDisplay_WrapPointWithinSingleLineBudget_GrantsTwoLineBudgetAndKeepsTheSpace()
        {
            var label = "Waaz Mubarak-Al-Masjid al-Moazzam-Surat-Extra-Padding-To-Force-Truncation"; // first space at index 4
            var result = RefinementWorkspaceModel.TruncateForDisplay(label, canvasWidthPixels: 80);

            Assert.True(result.Length < label.Length);
            Assert.Contains(" ", result);
            Assert.StartsWith("Waaz Mubarak", result);
            Assert.EndsWith("…", result);
        }

        // ── Unknown future state fields (System.Text.Json default-ignore) ──

        [Fact]
        public void AutoIngestState_Deserialization_IgnoresUnknownTagRefinementFields()
        {
            var json = """
            {
              "context": "browse",
              "selectedCount": 2,
              "hasSelection": true,
              "previewOpen": false,
              "availableCommands": ["tagRefinement.applyToSelected"],
              "tagRefinement": {
                "active": true,
                "scopeLabel": "G1",
                "componentLabel": "Waaz",
                "selectedCount": 2,
                "status": "mixed",
                "tags": [
                  { "id": "eventTypes:Waaz", "category": "eventTypes", "label": "Waaz", "state": "checked", "futureField": 123 }
                ],
                "canApply": true,
                "futureTopLevelField": "something AutoIngest adds later"
              }
            }
            """;

            var state = System.Text.Json.JsonSerializer.Deserialize<AutoIngestState>(json);

            Assert.NotNull(state?.TagRefinement);
            Assert.True(state!.TagRefinement!.Active);
            Assert.Single(state.TagRefinement.Tags!);
            Assert.Equal("eventTypes:Waaz", state.TagRefinement.Tags![0].Id);
        }
    }
}
