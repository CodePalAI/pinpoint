/*
 * Pinpoint opaque-flow asynchronous runtime boundary.
 *
 * This model separates authorization, dispatch, and terminal receipt emission.
 * It does not model values or policy predicates; formal/opaque_flow.pml owns
 * those properties.
 */

#define MAX_STEPS 8

mtype = {
    Start,
    PreAbortedStart,
    CatalogValid,
    CatalogInvalid,
    Dispatch,
    DuplicateFlowAttempt,
    CompleteSuccess,
    CompleteMalformed,
    CompleteProcessLoss
};

bool startup_decided = false;
bool pre_aborted = false;
bool started = false;
bool catalog_valid = false;
bool pending = false;

byte dispatches = 0;
byte receipts = 0;
byte receipt_sequence = 0;
byte receipt_previous = 0;

inline emit_terminal(success_value) {
    pending = false;
    receipt_previous = receipt_sequence;
    receipt_sequence++;
    receipts++;
    receipt_emitted = true;
    receipt_success = success_value
}

active proctype AsyncBoundary() {
    byte steps = 0;
    byte dispatches_before;
    byte receipts_before;
    byte sequence_before;
    mtype action;

    bool dispatched;
    bool duplicate_denied;
    bool receipt_emitted;
    bool receipt_success;
    bool terminal_failure;

    do
    :: steps < MAX_STEPS ->
        dispatches_before = dispatches;
        receipts_before = receipts;
        sequence_before = receipt_sequence;
        dispatched = false;
        duplicate_denied = false;
        receipt_emitted = false;
        receipt_success = false;
        terminal_failure = false;

        if
        :: action = Start;
           if
           :: !startup_decided ->
              startup_decided = true;
              started = true
           :: startup_decided && !pre_aborted ->
              started = true
           :: else -> skip
           fi

        :: action = PreAbortedStart;
           if
           :: !startup_decided && !started ->
              startup_decided = true;
              pre_aborted = true
           :: else -> skip
           fi

        :: action = CatalogValid;
           if
           :: started -> catalog_valid = true
           :: else -> skip
           fi

        :: action = CatalogInvalid;
           catalog_valid = false

        :: action = Dispatch;
           if
           :: started && catalog_valid && !pending ->
              pending = true;
              dispatches++;
              dispatched = true
           :: else -> skip
           fi

        :: action = DuplicateFlowAttempt;
           if
           :: pending -> duplicate_denied = true
           :: else -> skip
           fi

        :: action = CompleteSuccess;
           if
           :: pending -> emit_terminal(true)
           :: else -> skip
           fi

        :: action = CompleteMalformed;
           if
           :: pending ->
              terminal_failure = true;
              emit_terminal(false)
           :: else -> skip
           fi

        :: action = CompleteProcessLoss;
           if
           :: pending ->
              terminal_failure = true;
              emit_terminal(false)
           :: else -> skip
           fi
        fi;

        assert(!pre_aborted || !started);
        assert(!dispatched || (started && catalog_valid));
        assert(!duplicate_denied || dispatches == dispatches_before);
        assert(receipt_sequence == receipts);
        if
        :: pending -> assert(dispatches == receipts + 1)
        :: else -> assert(dispatches == receipts)
        fi;
        assert(!receipt_emitted ||
               (receipts == receipts_before + 1 &&
                receipt_previous == sequence_before &&
                receipt_sequence == sequence_before + 1));
        assert(receipt_emitted || receipts == receipts_before);
        assert(!terminal_failure || (receipt_emitted && !receipt_success));

        steps++

    :: else -> break
    od
}