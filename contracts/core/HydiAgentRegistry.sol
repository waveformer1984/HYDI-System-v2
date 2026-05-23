// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * HydiAgentRegistry — On-Chain Execution Verification Ledger
 *
 * Records cryptographic proof that a HYDI worker satisfied all constitutional
 * invariants before a payload is considered canonical. The substrate orchestrator
 * (the deployer address) is the only account authorised to log records.
 *
 * Invariants enforced on-chain:
 *   - correlationId uniqueness: duplicate IDs are rejected (collision guard)
 *   - Orchestrator-only writes: onlyOrchestrator modifier on logExecution
 *   - Immutable orchestrator: set once in constructor, never changeable
 */

contract HydiAgentRegistry {
    address public immutable substrateOrchestrator;

    struct ExecutionRecord {
        string  correlationId;
        bytes32 stateRootHash;
        uint256 timestamp;
        bool    invariantPassed;
    }

    // correlationId → execution record
    mapping(string => ExecutionRecord) private _records;

    // Ordered list of all correlation IDs for enumeration
    string[] private _correlationIds;

    event ExecutionLogged(
        string  indexed correlationId,
        bytes32 indexed stateRootHash,
        bool            invariantPassed
    );

    modifier onlyOrchestrator() {
        require(
            msg.sender == substrateOrchestrator,
            "HydiAgentRegistry: sender must be authorized Core Node"
        );
        _;
    }

    constructor() {
        substrateOrchestrator = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write path
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Log the outcome of a HYDI agent execution.
     * Can only be called by the substrate orchestrator (deployer).
     *
     * @param correlationId   Distributed-trace correlation ID from hydi-processor
     * @param stateRootHash   keccak256 of the serialised payload / state diff
     * @param invariantPassed True if all SelfReflectionEngine invariants cleared
     */
    function logExecution(
        string  calldata correlationId,
        bytes32          stateRootHash,
        bool             invariantPassed
    ) external onlyOrchestrator {
        require(
            _records[correlationId].timestamp == 0,
            "HydiAgentRegistry: record identity collision"
        );

        _records[correlationId] = ExecutionRecord({
            correlationId:  correlationId,
            stateRootHash:  stateRootHash,
            timestamp:      block.timestamp,
            invariantPassed: invariantPassed
        });

        _correlationIds.push(correlationId);

        emit ExecutionLogged(correlationId, stateRootHash, invariantPassed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Read path
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Verify a logged execution record.
     *
     * @param correlationId  The correlation ID to look up
     * @return stateRootHash The hash logged at write time
     * @return timestamp     Block timestamp when record was written
     * @return invariantPassed Whether invariants were satisfied
     */
    function verifyRecord(string calldata correlationId)
        external
        view
        returns (bytes32 stateRootHash, uint256 timestamp, bool invariantPassed)
    {
        ExecutionRecord memory rec = _records[correlationId];
        require(rec.timestamp > 0, "HydiAgentRegistry: record not found");
        return (rec.stateRootHash, rec.timestamp, rec.invariantPassed);
    }

    /**
     * Return total number of execution records logged.
     */
    function totalRecords() external view returns (uint256) {
        return _correlationIds.length;
    }

    /**
     * Enumerate correlation IDs by index (for off-chain indexing).
     */
    function correlationIdAt(uint256 index) external view returns (string memory) {
        require(index < _correlationIds.length, "HydiAgentRegistry: index out of bounds");
        return _correlationIds[index];
    }
}
