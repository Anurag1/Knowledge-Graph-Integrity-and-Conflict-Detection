from context_graph import ContextGraph, Event


def test_same_word_changes_with_tone() -> None:
    graph = ContextGraph()
    cases = [
        ("calm", "acknowledgement"),
        ("enthusiastic", "agreement"),
        ("frustrated", "reluctance"),
    ]

    for index, (tone, expected) in enumerate(cases):
        event = Event(index, "user", "speech", "okay", tone=tone)
        graph.add_event(event)
        assert graph.interpret(event).label == expected


def test_action_and_movement_override_literal_word() -> None:
    graph = ContextGraph()
    event = Event(
        1,
        "user",
        "speech",
        "okay",
        tone="neutral",
        action="walk_away",
        movement="toward_door",
    )
    graph.add_event(event)
    result = graph.interpret(event)
    assert result.label == "conversation_end"
    assert "departure cue" in result.evidence


def test_prior_state_changes_interpretation() -> None:
    graph = ContextGraph()
    graph.add_event(Event(1, "user", "text", "I rejected option B"))
    event = Event(2, "user", "speech", "okay", tone="neutral")
    graph.add_event(event)
    result = graph.interpret(event)
    assert result.label == "acknowledgement"
    assert "prior task state" in result.evidence
