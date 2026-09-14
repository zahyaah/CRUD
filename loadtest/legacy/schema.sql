-- The pre-revamp table shape: `id` is the client-supplied primary key that
-- backend/server.js:73-78 bound straight from the request body, with no version column and
-- no idempotency ledger. Used only by the legacy baseline run.

CREATE DATABASE IF NOT EXISTS warehouse_legacy;
USE warehouse_legacy;

DROP VIEW IF EXISTS product;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS PRODUCT;

-- Named in uppercase to match server.js:44/:77/:95, with a lowercase view for the DELETE at
-- server.js:110. The original mixed both spellings, which is invisible on a case-insensitive
-- macOS filesystem and fatal on Linux, where this container runs. The view exists purely so
-- the baseline measures concurrency behaviour rather than that naming bug.
CREATE TABLE PRODUCT (
    id             INT            NOT NULL,
    name           VARCHAR(255)   NOT NULL,
    description    TEXT           NOT NULL,
    price          DECIMAL(10, 2) NOT NULL,
    category       VARCHAR(100)   NOT NULL,
    stock_quantity INT            NOT NULL,
    manufacturer   VARCHAR(255)   NOT NULL,
    release_date   DATE           NOT NULL,
    rating         DECIMAL(2, 1)  NOT NULL,
    PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE VIEW product AS SELECT * FROM PRODUCT;
