# Cowrie Milestone Escrow

一个基于 **Solana + Anchor** 的里程碑付款托管练习项目，使用 SPL Token（示例代币 CWR）演示资金托管、分阶段付款和到期退款。

> 本项目用于学习和作品展示，尚未经过安全审计，不建议用于真实资金托管。

## 项目组成

- **`cowrie_issuer`**：创建并铸造测试用的 CWR Token，不参与托管业务。
- **`milestone_escrow`**：管理合同、里程碑、资金托管、批准、领取和退款。

## 主要流程

1. **创建合同**：Creator 指定 Beneficiary、合同总金额及截止时间，并添加里程碑。
2. **存入资金**：里程碑金额合计达到合同金额后，Creator 将全部 Token 转入当前 Escrow 独立的 Vault ATA，合同进入 `Active`。
3. **批准并领取**：Creator 批准里程碑，Beneficiary 可领取相应款项；所有款项领取完毕后合同进入 `Completed`。
4. **到期退款**：超过截止时间且不存在已批准但尚未领取的款项时，Creator 可取回未支付的余额，合同进入 `Cancelled`。

## 关键实现

- 使用 **PDA** 标识 Escrow、Milestone，并作为 Vault 的 Token Authority。
- 使用 **`transfer_checked` + PDA 签名** 执行领取和退款。
- 校验 Mint、Token Account、签名身份及账户之间的归属关系。
- 通过里程碑状态和资金记账防止重复领取及错误退款。

## 本地测试

```bash
anchor test --script escrow
```

已验证初始化、资金存入、里程碑批准与领取，以及提前退款和未领取已批准款项的退款限制。当前集成测试结果：**5 passing**。

工程检查：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets
```

## 已知限制

- 创建 Escrow 使用全局递增 ID，高并发下存在写锁竞争。
- 已批准但长期未领取的款项会阻止退款，可能造成资金长期锁定。
- 暂不支持争议仲裁、自动结算等复杂业务。
- 测试重点覆盖核心流程，尚未进行完整的对抗性安全测试。
