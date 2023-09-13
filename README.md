# Simple token with vulnerabilities

This project implements the voting system for a new token price.

It's based on a descending linked list to efficiently get the information about a price: its price, its position, etc.

Some actions like determining a new node position are made off-chain due to the limitation of time complexity for on-chain. But there are respective checks in the latter to validate the data passed from the first one.

Tech stack: Solidity (for smart contracts), Hardhat (as a development environment), Typescript + ethers.js (for testing)
