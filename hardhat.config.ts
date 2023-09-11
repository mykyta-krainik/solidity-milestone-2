import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

task('deploy', 'Deploys the contract', async () => {

});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19"
  },
};

export default config;
