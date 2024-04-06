import { JsonRpcSigner, TransactionResponse } from "@ethersproject/providers";
import { BigNumber, BigNumberish, Contract, ethers } from "ethers";
import { erc20Abi, permit2Abi } from "../abis";
import { AppState, app } from "../app-state";
import { permit2Address } from "../constants";
import { supabase } from "../render-transaction/read-claim-data-from-url";
import { Erc20Permit, Erc721Permit, RewardPermit } from "../render-transaction/tx-type";
import { MetaMaskError, buttonController, errorToast, getMakeClaimButton, toaster } from "../toaster";

export async function fetchTreasury(
  permit: Erc20Permit | Erc721Permit
): Promise<{ balance: BigNumber; allowance: BigNumber; decimals: number; symbol: string }> {
  let balance: BigNumber, allowance: BigNumber, decimals: number, symbol: string;

  try {
    const tokenAddress = permit.permit.permitted.token;
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, app.provider);

    // Try to get the token info from localStorage
    const tokenInfo = localStorage.getItem(tokenAddress);

    if (tokenInfo) {
      // If the token info is in localStorage, parse it and use it
      const { decimals: storedDecimals, symbol: storedSymbol } = JSON.parse(tokenInfo);
      decimals = storedDecimals;
      symbol = storedSymbol;
      [balance, allowance] = await Promise.all([tokenContract.balanceOf(permit.owner), tokenContract.allowance(permit.owner, permit2Address)]);
    } else {
      // If the token info is not in localStorage, fetch it from the blockchain
      [balance, allowance, decimals, symbol] = await Promise.all([
        tokenContract.balanceOf(permit.owner),
        tokenContract.allowance(permit.owner, permit2Address),
        tokenContract.decimals(),
        tokenContract.symbol(),
      ]);

      // Store the token info in localStorage for future use
      localStorage.setItem(tokenAddress, JSON.stringify({ decimals, symbol }));
    }

    return { balance, allowance, decimals, symbol };
  } catch (error: unknown) {
    return { balance: BigNumber.from(-1), allowance: BigNumber.from(-1), decimals: -1, symbol: "" };
  }
}

async function checkPermitClaimability(app: AppState, reward: RewardPermit): Promise<boolean> {
  try {
    return await checkPermitClaimable(app, reward);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const e = error as unknown as MetaMaskError;
      console.error("Error in checkPermitClaimable: ", e);
      errorToast(e, e.reason);
    }
  }
  buttonController.hideMakeClaim(reward);
  return false;
}

async function transferFromPermit(permit2Contract: Contract, app: AppState, reward: RewardPermit) {
  try {
    const tx = await permit2Contract.permitTransferFrom(reward.permit, reward.transferDetails, reward.owner, reward.signature);
    toaster.create("info", `Transaction sent`);
    return tx;
  } catch (error: unknown) {
    if (error instanceof Error) {
      const e = error as unknown as MetaMaskError;
      // Check if the error message indicates a user rejection
      if (e.code == "ACTION_REJECTED") {
        // Handle the user rejection case
        toaster.create("info", `Transaction was not sent because it was rejected by the user.`);
        buttonController.hideLoader(reward);
        buttonController.showMakeClaim(reward);
      } else {
        // Handle other errors
        console.error("Error in permitTransferFrom: ", e);
        errorToast(e, e.reason);
      }
    }
    return null;
  }
}

async function waitForTransaction(tx: TransactionResponse, reward: RewardPermit) {
  try {
    const receipt = await tx.wait();
    toaster.create("success", `Claim Complete.`);
    buttonController.showViewClaim(reward);
    buttonController.hideLoader(reward);
    buttonController.hideMakeClaim(reward);
    console.log(receipt.transactionHash);
    return receipt;
  } catch (error: unknown) {
    if (error instanceof Error) {
      const e = error as unknown as MetaMaskError;
      console.error("Error in tx.wait: ", e);
      errorToast(e, e.reason);
    }
  }
}

export function claimErc20PermitHandlerWrapper(app: AppState, reward: RewardPermit) {
  return async function claimErc20PermitHandler() {
    buttonController.hideMakeClaim(reward);
    buttonController.showLoader(reward);

    const isPermitClaimable = await checkPermitClaimability(app, reward);
    if (!isPermitClaimable) return;

    const permit2Contract = new ethers.Contract(permit2Address, permit2Abi, app.signer);
    if (!permit2Contract) return;

    const tx = await transferFromPermit(permit2Contract, app, reward);
    if (!tx) return;

    buttonController.showLoader(reward);
    buttonController.hideMakeClaim(reward);

    const receipt = await waitForTransaction(tx, reward);
    if (!receipt) return;

    const isHashUpdated = await updatePermitTxHash(reward, receipt.transactionHash);
    if (!isHashUpdated) return;

    getMakeClaimButton(reward).removeEventListener("click", claimErc20PermitHandler);
  };
}

async function checkPermitClaimable(app: AppState, reward: RewardPermit): Promise<boolean> {
  let isClaimed: boolean;
  try {
    isClaimed = await isNonceClaimed(app, reward);
  } catch (error: unknown) {
    console.error("Error in isNonceClaimed: ", error);
    return false;
  }

  if (isClaimed) {
    toaster.create("error", `Your reward for this task has already been claimed.`);
    buttonController.showViewClaim(reward);
    return false;
  }

  if (reward.permit.deadline.lt(Math.floor(Date.now() / 1000))) {
    toaster.create("error", `This reward has expired.`);
    return false;
  }

  const { balance, allowance } = await fetchTreasury(reward);
  const permit = reward.permit;
  const permitted = BigNumber.from(permit.permitted.amount);

  const isSolvent = balance.gte(permitted);
  const isAllowed = allowance.gte(permitted);

  if (!isSolvent) {
    toaster.create("error", `Not enough funds on funding wallet to collect this reward. Please let the financier know.`);
    buttonController.hideMakeClaim(reward);
    return false;
  }
  if (!isAllowed) {
    toaster.create("error", `Not enough allowance on the funding wallet to collect this reward. Please let the financier know.`);
    buttonController.hideMakeClaim(reward);
    return false;
  }

  //Do I use the first reward to get network Id etc

  let user: string;
  try {
    user = (await app.signer.getAddress()).toLowerCase();
  } catch (error: unknown) {
    console.error("Error in signer.getAddress: ", error);
    return false;
  }

  const beneficiary = reward.transferDetails.to.toLowerCase();
  if (beneficiary !== user) {
    toaster.create("warning", `This reward is not for you.`);
    buttonController.hideMakeClaim(reward);
    return false;
  }

  return true;
}

export async function checkRenderMakeClaimControl(app: AppState, reward?: RewardPermit) {
  try {
    const address = await app.signer.getAddress();
    const user = address.toLowerCase();

    if (reward) {
      const beneficiary = reward.transferDetails.to.toLowerCase();
      if (beneficiary !== user) {
        buttonController.hideMakeClaim(reward);
        return;
      }
    }
  } catch (error) {
    console.error("Error getting address from signer");
    console.error(error);
  }
  buttonController.showMakeClaim(reward);
}

export async function checkRenderInvalidatePermitAdminControl(app: AppState, reward?: RewardPermit) {
  try {
    const address = await app.signer.getAddress();
    const user = address.toLowerCase();

    if (reward) {
      const owner = reward.owner.toLowerCase();
      if (owner !== user) {
        buttonController.hideInvalidator(reward);
        return;
      }
    }
  } catch (error) {
    console.error("Error getting address from signer");
    console.error(error);
  }
  buttonController.showInvalidator(reward);
}

export function handleInvalidateButton(table: HTMLTableElement, reward: RewardPermit) {
  const invalidateButton = table.querySelector(".invalidator") as HTMLDivElement;

  invalidateButton.addEventListener("click", async function invalidateButtonClickHandler() {
    try {
      const isClaimed = await isNonceClaimed(app, reward);
      if (isClaimed) {
        toaster.create("error", `This reward has already been claimed or invalidated.`);
        buttonController.hideInvalidator(reward);
        return;
      }
      await invalidateNonce(app.signer, reward.permit.nonce);
    } catch (error: unknown) {
      if (error instanceof Error) {
        const e = error as unknown as MetaMaskError;
        console.error(e);
        errorToast(e, e.reason);
        return;
      }
    }
    toaster.create("info", "Nonce invalidation transaction sent");
    buttonController.hideInvalidator(reward);
  });
}

//mimics https://github.com/Uniswap/permit2/blob/a7cd186948b44f9096a35035226d7d70b9e24eaf/src/SignatureTransfer.sol#L150
async function isNonceClaimed(app: AppState, reward: RewardPermit): Promise<boolean> {
  const provider = app.provider;

  const permit2Contract = new ethers.Contract(permit2Address, permit2Abi, provider);

  const { wordPos, bitPos } = nonceBitmap(BigNumber.from(reward.permit.nonce));

  const bitmap = await permit2Contract.nonceBitmap(reward.owner, wordPos).catch((error: MetaMaskError) => {
    console.error("Error in nonceBitmap method: ", error);
    throw error;
  });

  const bit = BigNumber.from(1).shl(bitPos);
  const flipped = BigNumber.from(bitmap).xor(bit);

  return bit.and(flipped).eq(0);
}

async function invalidateNonce(signer: JsonRpcSigner, nonce: BigNumberish): Promise<void> {
  const permit2Contract = new ethers.Contract(permit2Address, permit2Abi, signer);
  const { wordPos, bitPos } = nonceBitmap(nonce);
  // mimics https://github.com/ubiquity/pay.ubq.fi/blob/c9e7ed90718fe977fd9f348db27adf31d91d07fb/scripts/solidity/test/Permit2.t.sol#L428
  const bit = BigNumber.from(1).shl(bitPos);
  const sourceBitmap = await permit2Contract.nonceBitmap(await signer.getAddress(), wordPos.toString());
  const mask = sourceBitmap.or(bit);
  await permit2Contract.invalidateUnorderedNonces(wordPos, mask);
}

// mimics https://github.com/Uniswap/permit2/blob/db96e06278b78123970183d28f502217bef156f4/src/SignatureTransfer.sol#L142
function nonceBitmap(nonce: BigNumberish): { wordPos: BigNumber; bitPos: number } {
  // wordPos is the first 248 bits of the nonce
  const wordPos = BigNumber.from(nonce).shr(8);
  // bitPos is the last 8 bits of the nonce
  const bitPos = BigNumber.from(nonce).and(255).toNumber();
  return { wordPos, bitPos };
}

async function updatePermitTxHash(reward: RewardPermit, hash: string): Promise<boolean> {
  const { error } = await supabase
    .from("permits")
    .update({ transaction: hash })
    // using only nonce in the condition as it's defined unique on db
    .eq("nonce", reward.permit.nonce.toString());

  if (error !== null) {
    console.error(error);
    throw error;
  }

  return true;
}
