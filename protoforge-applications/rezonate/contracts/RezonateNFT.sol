// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RezonateNFT — minimal ERC-721 for Rezonate audio assets.
/// Minting is restricted to the contract owner (the studio/operator wallet).
/// tokenURI points at deterministic off-chain metadata served by Rezonate.
contract RezonateNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId = 1;

    /// content hash => tokenId, prevents duplicate mints of the same asset
    mapping(bytes32 => uint256) public tokenByContentHash;

    event Minted(uint256 indexed tokenId, address indexed to, bytes32 indexed contentHash, string tokenUri);

    constructor() ERC721("Rezonate Asset", "RZN") Ownable(msg.sender) {}

    function mint(address to, string calldata uri, bytes32 contentHash) external onlyOwner returns (uint256) {
        require(to != address(0), "mint to zero address");
        require(contentHash != bytes32(0), "empty content hash");
        require(tokenByContentHash[contentHash] == 0, "content already minted");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        tokenByContentHash[contentHash] = tokenId;
        emit Minted(tokenId, to, contentHash, uri);
        return tokenId;
    }
}
