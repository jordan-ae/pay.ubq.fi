import { BigNumber, ethers } from "ethers";
import { AppState, app } from "../app-state";
import { Erc721Permit } from "./tx-type";

export function shortenAddress(address: string): string {
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

export function insertErc20PermitTableData(
  app: AppState,
  table: Element,
  treasury: { balance: BigNumber; allowance: BigNumber; decimals: number; symbol: string }
): Element {
  const permit = app.permit;
  const requestedAmountElement = document.getElementById("rewardAmount") as Element;
  renderToFields(permit.transferDetails.to, app.currentExplorerUrl);
  renderTokenFields(permit.permit.permitted.token, app.currentExplorerUrl);
  renderDetailsFields([
    { name: "From", value: `<a target="_blank" rel="noopener noreferrer" href="${app.currentExplorerUrl}/address/${permit.owner}">${permit.owner}</a>` },
    {
      name: "Expiry",
      value: (() => {
        const deadline = BigNumber.isBigNumber(permit.permit.deadline) ? permit.permit.deadline : BigNumber.from(permit.permit.deadline);
        return deadline.lte(Number.MAX_SAFE_INTEGER.toString()) ? new Date(deadline.toNumber()).toLocaleString() : undefined;
      })(),
    },
    { name: "Balance", value: treasury.balance.gte(0) ? `${ethers.utils.formatUnits(treasury.balance, treasury.decimals)} ${treasury.symbol}` : "N/A" },
    { name: "Allowance", value: treasury.allowance.gte(0) ? `${ethers.utils.formatUnits(treasury.allowance, treasury.decimals)} ${treasury.symbol}` : "N/A" },
  ]);
  table.setAttribute(`data-claim-rendered`, "true");
  return requestedAmountElement;
}

export function insertErc721PermitTableData(permit: Erc721Permit, table: Element): Element {
  const requestedAmountElement = document.getElementById("rewardAmount") as Element;
  renderToFields(permit.transferDetails.to, app.currentExplorerUrl);
  renderTokenFields(permit.permit.permitted.token, app.currentExplorerUrl);
  const { GITHUB_REPOSITORY_NAME, GITHUB_CONTRIBUTION_TYPE, GITHUB_ISSUE_ID, GITHUB_ORGANIZATION_NAME, GITHUB_USERNAME } = permit.nftMetadata;
  renderDetailsFields([
    {
      name: "NFT address",
      value: `<a target="_blank" rel="noopener noreferrer" href="${app.currentExplorerUrl}/address/${permit.permit.permitted.token}">${permit.permit.permitted.token}</a>`,
    },
    {
      name: "Expiry",
      value: permit.permit.deadline.lte(Number.MAX_SAFE_INTEGER.toString()) ? new Date(permit.permit.deadline.toNumber()).toLocaleString() : undefined,
    },
    {
      name: "GitHub Organization",
      value: `<a target="_blank" rel="noopener noreferrer" href="https://github.com/${GITHUB_ORGANIZATION_NAME}">${GITHUB_ORGANIZATION_NAME}</a>`,
    },
    {
      name: "GitHub Repository",
      value: `<a target="_blank" rel="noopener noreferrer" href="https://github.com/${GITHUB_ORGANIZATION_NAME}/${GITHUB_REPOSITORY_NAME}">${GITHUB_REPOSITORY_NAME}</a>`,
    },
    {
      name: "GitHub Issue",
      value: `<a target="_blank" rel="noopener noreferrer" href="https://github.com/${GITHUB_ORGANIZATION_NAME}/${GITHUB_REPOSITORY_NAME}/issues/${GITHUB_ISSUE_ID}">${GITHUB_ISSUE_ID}</a>`,
    },
    {
      name: "GitHub Username",
      value: `<a target="_blank" rel="noopener noreferrer" href="https://github.com/${GITHUB_USERNAME}">${GITHUB_USERNAME}</a>`,
    },
    { name: "Contribution Type", value: GITHUB_CONTRIBUTION_TYPE.split(",").join(", ") },
  ]);
  table.setAttribute(`data-claim-rendered`, "true");
  return requestedAmountElement;
}

function renderDetailsFields(additionalDetails: { name: string; value: string | undefined }[]) {
  const additionalDetailsDiv = document.getElementById("additionalDetailsTable") as Element;
  let additionalDetailsHtml = "";
  for (const { name, value } of additionalDetails) {
    if (!value) continue;
    additionalDetailsHtml += `<tr>
      <th><div>${name}</div></th>
      <td><div>${value}</div></td>
    </tr>`;
  }

  additionalDetailsDiv.innerHTML = additionalDetailsHtml;
}

function renderTokenFields(tokenAddress: string, explorerUrl: string) {
  const tokenFull = document.querySelector("#Token .full") as Element;
  const tokenShort = document.querySelector("#Token .short") as Element;
  tokenFull.innerHTML = `<div>${tokenAddress}</div>`;
  tokenShort.innerHTML = `<div>${shortenAddress(tokenAddress)}</div>`;

  const tokenBoth = document.getElementById(`rewardToken`) as Element;
  tokenBoth.innerHTML = `<a target="_blank" rel="noopener noreferrer" href="${explorerUrl}/token/${tokenAddress}">${tokenBoth.innerHTML}</a>`;
}

function renderToFields(receiverAddress: string, explorerUrl: string) {
  const toFull = document.querySelector("#rewardRecipient .full") as Element;
  const toShort = document.querySelector("#rewardRecipient .short") as Element;

  // after a single claim toFull returns null as creates a toaster error
  if(!toFull || !toShort) return console.error("Could not find toFull or toShort");

  toFull.innerHTML = `<div>${receiverAddress}</div>`;
  toShort.innerHTML = `<div>${shortenAddress(receiverAddress)}</div>`;

  const toBoth = document.getElementById(`rewardRecipient`) as Element;
  toBoth.innerHTML = `<a target="_blank" rel="noopener noreferrer" href="${explorerUrl}/address/${receiverAddress}">${toBoth.innerHTML}</a>`;
}
