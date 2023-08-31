// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

contract MyERC20 is IERC20 {
    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    modifier notZeroAddress(address addr, string memory message) {
        require(addr != address(0), message);
        _;
    }

    modifier notToYourself(address from, address to) {
        require(from != to, "MyERC20: transfer to yourself");
        _;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        _transfer(msg.sender, to, amount);

        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        require(_balances[msg.sender] >= amount, "MyERC20: approve amount exceeds balance");

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
    )
        internal
        virtual
        notZeroAddress(from, "MyERC20: transfer from the zero address")
        notZeroAddress(to, "MyERC20: transfer to the zero address")
        notToYourself(from, to)
    {
        require(_balances[from] >= amount, "MyERC20: transfer amount exceeds balance");

        _balances[from] -= amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    )
        internal
        virtual
        notZeroAddress(owner, "MyERC20: owner is the zero address")
        notZeroAddress(spender, "MyERC20: spender is the zero address")
        notToYourself(owner, spender)
    {
        _allowances[owner][spender] = amount;

        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    )
        internal
        virtual
        notZeroAddress(owner, "MyERC20: owner is the zero address")
        notZeroAddress(spender, "MyERC20: spender is the zero address")
    {
        require(_allowances[owner][spender] >= amount, "MyERC20: transfer amount exceeds allowance");

        _approve(owner, spender, _allowances[owner][spender] - amount);
    }

    function _mint(
        address account,
        uint256 amount
    ) internal virtual notZeroAddress(account, "MyERC20: mint from the zero address") {
        _totalSupply += amount;
        _balances[account] += amount;

        emit Transfer(address(0), account, amount);
    }

    function _burn(
        address account,
        uint256 amount
    ) internal virtual notZeroAddress(account, "MyERC20: burn from the zero address") {
        require(_balances[account] >= amount, "MyERC20: burn amount exceeds balance");

        _totalSupply -= amount;
        _balances[account] -= amount;

        emit Transfer(account, address(0), amount);
    }
}
