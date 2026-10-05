// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RezonateMarket — fixed-price escrowed listings for Rezonate NFTs.
/// Seller lists an NFT (escrowed here); buyer pays `price`; seller receives
/// price minus platformFeeBps; the NFT transfers atomically on payment.
contract RezonateMarket is IERC721Receiver, ReentrancyGuard, Ownable {
    struct Listing {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    uint256 public nextListingId = 1;
    uint256 public platformFeeBps; // e.g. 250 = 2.5%
    address public feeRecipient;

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed listingId, address indexed seller, address nft, uint256 tokenId, uint256 price);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 price, uint256 fee);
    event Cancelled(uint256 indexed listingId);

    constructor(uint256 _feeBps, address _feeRecipient) Ownable(msg.sender) {
        require(_feeBps <= 1000, "fee too high"); // max 10%
        platformFeeBps = _feeBps;
        feeRecipient = _feeRecipient == address(0) ? msg.sender : _feeRecipient;
    }

    function list(address nft, uint256 tokenId, uint256 price) external returns (uint256) {
        require(price > 0, "price must be > 0");
        IERC721 token = IERC721(nft);
        require(token.ownerOf(tokenId) == msg.sender, "not token owner");
        uint256 listingId = nextListingId++;
        token.transferFrom(msg.sender, address(this), tokenId); // escrow
        listings[listingId] = Listing(msg.sender, nft, tokenId, price, true);
        emit Listed(listingId, msg.sender, nft, tokenId, price);
        return listingId;
    }

    function buy(uint256 listingId) external payable nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "listing not active");
        require(msg.value == l.price, "incorrect payment");
        l.active = false; // effects before interactions
        uint256 fee = (l.price * platformFeeBps) / 10000;
        uint256 proceeds = l.price - fee;
        IERC721(l.nft).transferFrom(address(this), msg.sender, l.tokenId);
        (bool sentSeller, ) = payable(l.seller).call{value: proceeds}("");
        require(sentSeller, "seller payment failed");
        if (fee > 0) {
            (bool sentFee, ) = payable(feeRecipient).call{value: fee}("");
            require(sentFee, "fee payment failed");
        }
        emit Sold(listingId, msg.sender, l.price, fee);
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "listing not active");
        require(l.seller == msg.sender, "not seller");
        l.active = false;
        IERC721(l.nft).transferFrom(address(this), l.seller, l.tokenId);
        emit Cancelled(listingId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
