// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract MyERC20 is IERC20 {
    error TransferToZeroAddressError();
    error TransferFromZeroAddressError();
    error TransferToYourselfError();

    error BalanceIsNotEnoughError(uint256 yourBalance, uint256 minBalance);
    error AllowanceIsNotEnoughError(uint256 yourAllowance, uint256 yourRequestedAmount);

    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    modifier notToZeroAddress(address addr) {
        if (addr == address(0)) {
            revert TransferToZeroAddressError();
        }
        _;
    }

    modifier notFromZeroAddress(address addr) {
        if (addr == address(0)) {
            revert TransferFromZeroAddressError();
        }
        _;
    }

    modifier notToYourself(address from, address to) {
        if (from == to) {
            revert TransferToYourselfError();
        }
        _;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        _transfer(msg.sender, to, amount);

        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(
        address spender,
        uint256 amount
    ) external override notToYourself(msg.sender, spender) returns (bool) {
        if (_balances[msg.sender] < amount) {
            revert BalanceIsNotEnoughError(_balances[msg.sender], amount);
        }

        _approve(msg.sender, spender, amount);

        return true;
    }

    function transferFrom(address owner, address to, uint256 amount) public virtual override returns (bool) {
        address spender = msg.sender;

        _spendAllowance(owner, spender, amount);
        _transfer(owner, to, amount);

        return true;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual notFromZeroAddress(from) notToZeroAddress(to) {
        if (_balances[from] < amount) {
            revert BalanceIsNotEnoughError(_balances[from], amount);
        }

        _balances[from] -= amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual notFromZeroAddress(owner) notToZeroAddress(spender) notToYourself(owner, spender) {
        _allowances[owner][spender] = amount;

        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual notFromZeroAddress(owner) notToZeroAddress(spender) {
        if (_allowances[owner][spender] < amount) {
            revert AllowanceIsNotEnoughError(_allowances[owner][spender], amount);
        }

        _approve(owner, spender, _allowances[owner][spender] - amount);
    }

    function _mint(address account, uint256 amount) internal virtual notToZeroAddress(account) {
        _totalSupply += amount;
        _balances[account] += amount;

        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal virtual notFromZeroAddress(account) {
        if (_balances[account] < amount) {
            revert BalanceIsNotEnoughError(_balances[account], amount);
        }

        _totalSupply -= amount;
        _balances[account] -= amount;

        emit Transfer(account, address(0), amount);
    }
}
