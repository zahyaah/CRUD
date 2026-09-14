-- Reconstructed from the SQL string literals in backend/server.js at tag `pre-revamp`.
-- The original DDL was never committed and is unrecoverable (confirmed by the repo owner,
-- 2026-09-14). Column names and order come from server.js:77-78; types are inferred from
-- how each value was coerced before binding (parseInt / parseFloat / raw string).

CREATE TABLE product (
    id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name           VARCHAR(255)    NOT NULL,
    description    TEXT            NOT NULL,
    -- parseFloat at server.js:78 bound price as a float. DECIMAL is used here instead so
    -- money arithmetic stays exact; binary floats cannot represent values like 0.10.
    price          DECIMAL(10, 2)  NOT NULL,
    category       VARCHAR(100)    NOT NULL,
    stock_quantity INT UNSIGNED    NOT NULL,
    manufacturer   VARCHAR(255)    NOT NULL,
    release_date   DATE            NOT NULL,
    rating         DECIMAL(2, 1)   NOT NULL,

    -- Optimistic locking. Every UPDATE carries the version the client last read and bumps
    -- it; a stale version matches zero rows, which surfaces the conflict instead of
    -- silently overwriting a concurrent edit.
    version        INT UNSIGNED    NOT NULL DEFAULT 1,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT chk_product_price  CHECK (price > 0),
    CONSTRAINT chk_product_rating CHECK (rating BETWEEN 1.0 AND 5.0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE INDEX idx_product_category ON product (category);

-- Coalescing lock + response ledger for mutating requests.
--
-- The PRIMARY KEY on idempotency_key is what actually enforces correctness: concurrent
-- requests carrying the same key race to INSERT, exactly one wins, and the losers get
-- ER_DUP_ENTRY. Correctness therefore holds across any number of application instances
-- without them coordinating. The winner is the leader and runs the pipeline; the losers
-- become waiters and poll this row for the leader's outcome.
CREATE TABLE idempotency_key (
    -- utf8mb4's default collation on MySQL 8 is accent- and case-insensitive, which would
    -- make "AbC" and "abc" the same primary key. Idempotency keys are opaque byte strings
    -- (base64, ULIDs, UUIDs), so two distinct keys colliding would silently merge two
    -- unrelated creates into one. Binary collation compares them exactly.
    idempotency_key VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,

    -- Fingerprint of the request body. A key replayed with a *different* payload is a
    -- client bug, not a retry, and must be rejected rather than served the cached response.
    request_fingerprint CHAR(64) NOT NULL,

    state ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing',

    response_status INT UNSIGNED   NULL,
    response_body   JSON           NULL,
    error_message   VARCHAR(1024)  NULL,
    resource_id     INT UNSIGNED   NULL,

    -- Identifies the current leader. A waiter that steals an expired lease writes its own
    -- token, so a revived original leader can detect it no longer owns the work and drop
    -- its result instead of overwriting the new leader's.
    leader_token CHAR(36) NOT NULL,

    -- Lease, not retention: when this passes while the row is still `processing`, the
    -- leader is presumed dead and a waiter may steal the work. Millisecond precision
    -- because the pipeline it guards completes in single-digit milliseconds.
    lease_expires_at TIMESTAMP(3) NOT NULL,

    created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completed_at TIMESTAMP(3) NULL,

    -- Retention: how long a completed response stays replayable.
    expires_at TIMESTAMP NOT NULL,

    PRIMARY KEY (idempotency_key),
    KEY idx_idempotency_expires (expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
