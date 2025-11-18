import { useEffect, useState } from 'react'
import './App.css'

type StatusResponse = {
  result: {
    sync_info: {
      latest_block_height: string
    }
  }
}

type BlockResponse = {
  result: {
    block_id: { hash: string }
    block: {
      header: {
        height: string
        time: string
        proposer_address: string
        chain_id: string
      }
      data: {
        txs: string[] | null
      }
      last_commit?: {
        round: number
      }
    }
  }
}


type TxSearchResponse = {
  result: {
    total_count: string
    txs: Array<{
      hash: string
      height: string
      tx: string
      tx_result: {
        code: number
        log: string
        gas_used: string
        gas_wanted: string
      }
    }>
  }
}

type AuthAccountsResponse = {
  accounts: Array<{
    '@type': string
    address: string
  }>
}

type BalancesResponse = {
  balances: Array<{
    denom: string
    amount: string
  }>
}

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

function App() {
  const [rpcUrl, setRpcUrl] = useState('http://localhost:26657')
  const [latestHeight, setLatestHeight] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [blockLoading, setBlockLoading] = useState(false)
  const [error, setError] = useState('')
  const [blockError, setBlockError] = useState('')
  const [block, setBlock] = useState<BlockResponse['result'] | null>(null)
  const [requestedHeight, setRequestedHeight] = useState('')
  // const [txCount, setTxCount] = useState(0)
  const [txs, setTxs] = useState<TxSearchResponse['result']['txs']>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState('')
  const [restUrl, setRestUrl] = useState('http://localhost:1317')
  const [accounts, setAccounts] = useState<
    Array<{
      address: string
      type: string
      balances: BalancesResponse['balances']
    }>
  >([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState('')

  // const deriveTxCount = useMemo(
  //   () =>
  //     (
  //       blockData: BlockResponse['result'] | null,
  //       blockResults: BlockResultsResponse['result'] | null,
  //     ) => {
  //       const txs = blockData?.block.data.txs || []
  //       if (txs.length > 0) return txs.length
  //       const resultsLength = blockResults?.txs_results?.length
  //       return resultsLength ?? 0
  //     },
  //   [],
  // )

  const fetchLatestHeight = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${rpcUrl}/status`)
      if (!res.ok) {
        throw new Error(`Status request failed (${res.status})`)
      }
      const data: StatusResponse = await res.json()
      const height = data.result.sync_info.latest_block_height
      setLatestHeight(height)
      return height
    } catch (err: unknown) {
      setLatestHeight('')
      setError(getErrorMessage(err) || '无法获取最新区块高度')
      return ''
    } finally {
      setLoading(false)
    }
  }

  const fetchBlock = async (height?: string) => {
    const targetHeight = height || requestedHeight || latestHeight
    if (!targetHeight) {
      setBlockError('请输入区块高度，或先刷新最新高度')
      return
    }

    setBlockLoading(true)
    setBlockError('')
    try {
      const blockUrl = `${rpcUrl}/block${targetHeight ? `?height=${targetHeight}` : ''}`
      // const resultsUrl = `${rpcUrl}/block_results${targetHeight ? `?height=${targetHeight}` : ''}`
      // const blockRes = await fetch(`${restUrl}/cosmos/base/tendermint/v1beta1/blocks/${targetHeight}`);
      const [blockRes] = await Promise.all([
        fetch(blockUrl),
      ])

      if (!blockRes.ok) {
        throw new Error(`Block request failed (${blockRes.status})`)
      }

      const blockData: BlockResponse = await blockRes.json()
      // const blockResults: BlockResultsResponse['result'] | null =
      //   resultsRes && resultsRes.ok ? ((await resultsRes.json()) as BlockResultsResponse).result : null

      setBlock(blockData.result)
      setRequestedHeight(targetHeight)
      // setTxCount(deriveTxCount(blockData.result, blockResults))
    } catch (err: unknown) {
      setBlock(null)
      // setTxCount(0)
      setBlockError(getErrorMessage(err) || '无法获取区块信息')
    } finally {
      setBlockLoading(false)
    }
  }

  const fetchTxs = async () => {
    setTxLoading(true)
    setTxError('')
    try {
      const perPage = 100
      // 先尝试带引号的查询（Tendermint 推荐），若失败再退化为不带引号
      const queryVariants = ['"tx.height>0"', 'tx.height>0']
      // 某些版本要求 order_by 以 JSON 字符串形式传递，否则会出现 invalid character 错误
      const orderVariants = ['"desc"', 'desc']

      let allTxs: TxSearchResponse['result']['txs'] = []
      let total = 0
      let success = false

      for (const query of queryVariants) {
        for (const order_by of orderVariants) {
          const baseParams = new URLSearchParams({
            query,
            per_page: String(perPage),
            order_by,
          })

          try {
            // 先拉取第 1 页，获得总数后再按需分页抓取
            const firstRes = await fetch(`${rpcUrl}/tx_search?${baseParams.toString()}&page=1`)
            if (!firstRes.ok) {
              throw new Error(`Tx search failed (${firstRes.status})`)
            }
            const firstData: TxSearchResponse = await firstRes.json()
            total = Number(firstData.result.total_count || 0)
            const totalPages = Math.max(1, Math.ceil(total / perPage))

            allTxs = firstData.result.txs || []

            for (let page = 2; page <= totalPages; page += 1) {
              const res = await fetch(`${rpcUrl}/tx_search?${baseParams.toString()}&page=${page}`)
              if (!res.ok) {
                throw new Error(`Tx search failed on page ${page} (${res.status})`)
              }
              const data: TxSearchResponse = await res.json()
              allTxs = allTxs.concat(data.result.txs || [])
            }

            success = true
            break
          } catch {
            // 尝试下一个组合
            continue
          }
        }
        if (success) break
      }

      if (!success) {
        throw new Error('Tx search failed for all query variants')
      }

      setTxs(allTxs)
      setTxTotal(total)
    } catch (err: unknown) {
      setTxs([])
      setTxTotal(0)
      setTxError(getErrorMessage(err) || '无法获取交易列表（请确认节点已开启 tx 索引）')
    } finally {
      setTxLoading(false)
    }
  }

  const fetchAccounts = async () => {
    setAccountsLoading(true)
    setAccountsError('')
    try {
      const accountsRes = await fetch(`${restUrl}/cosmos/auth/v1beta1/accounts?pagination.limit=100`)
      if (!accountsRes.ok) {
        throw new Error(`Accounts request failed (${accountsRes.status})`)
      }
      const accountsData: AuthAccountsResponse = await accountsRes.json()
      const items = accountsData.accounts || []

      const enriched = await Promise.all(
        items
          .filter((acc) => acc?.address)
          .map(async (acc) => {
          try {
            const balRes = await fetch(
              `${restUrl}/cosmos/bank/v1beta1/balances/${acc.address}?pagination.limit=100`,
            )
            if (!balRes.ok) {
              throw new Error('balance error')
            }
            const balData: BalancesResponse = await balRes.json()
            return {
              address: acc.address,
              type: acc['@type'],
              balances: balData.balances || [],
            }
          } catch {
            return {
              address: acc.address,
              type: acc['@type'],
              balances: [],
            }
          }
        }),
      )

      setAccounts(enriched)
    } catch (err: unknown) {
      setAccounts([])
      setAccountsError(getErrorMessage(err) || '无法获取账户列表')
    } finally {
      setAccountsLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const height = await fetchLatestHeight()
      if (height) {
        await fetchBlock(height)
      }
      await fetchTxs()
      await fetchAccounts()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shorten = (value: string, keep = 10) => {
    if (value.length <= keep * 2) return value
    return `${value.slice(0, keep)}…${value.slice(-keep)}`
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Testchain 区块浏览器</h1>
          <p className="muted">查看当前区块高度与区块详情（默认 Tendermint RPC 26657）</p>
        </div>
        <a className="link" href="https://docs.ignite.com" target="_blank" rel="noreferrer">
          Ignite 文档
        </a>
      </header>

      <section className="panel">
        <div className="panel__header">
          <h2>RPC 设置</h2>
          <span className="muted">默认本地运行的 testchain</span>
        </div>
        <label className="field">
          <span className="field__label">RPC 地址</span>
          <input
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
            placeholder="http://localhost:26657"
            spellCheck={false}
          />
        </label>
        <div className="actions">
          <button onClick={fetchLatestHeight} disabled={loading}>
            {loading ? '刷新中…' : '刷新最新高度'}
          </button>
          <span className="muted">当前高度：{latestHeight || '未知'}</span>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <div className='sectionWrap'>

      <section className="panel panel--grid">
        <div className="panel__header">
          <h2>REST & 账户</h2>
          <span className="muted">REST 默认 1317，可刷新账户与余额</span>
        </div>
        <label className="field">
          <span className="field__label">REST 地址</span>
          <input
            value={restUrl}
            onChange={(e) => setRestUrl(e.target.value)}
            placeholder="http://localhost:1317"
            spellCheck={false}
          />
        </label>
        <div className="actions">
          <button onClick={fetchAccounts} disabled={accountsLoading}>
            {accountsLoading ? '刷新中…' : '刷新账户列表'}
          </button>
          <span className="muted">共 {accounts.length} 个账户</span>
        </div>
        {accountsError && <p className="error">{accountsError}</p>}

        {accounts.length > 0 ? (
          <div className="account-grid">
            {accounts.map((acc) => (
              <div key={acc.address} className="account-card">
                <div className="account-card__row">
                  <span className="muted">地址</span>
                  <code className="mono">{shorten(acc.address, 14)}</code>
                </div>
                <div className="account-card__row">
                  <span className="muted">类型</span>
                  <span className="tag tag--ghost">{acc.type.split('.').pop() || acc.type}</span>
                </div>
                <div className="balances">
                  <span className="muted">余额</span>{acc.balances.length > 0 ? (
                    acc.balances.map((bal) => (
                      <span key={`${acc.address}-${bal.denom}`} className="chip">
                        {bal.amount} {bal.denom}
                      </span>
                    ))
                  ) : (
                    <span className="muted">暂无余额</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !accountsLoading && <p className="muted">暂无账户数据</p>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>区块信息</h2>
          <span className="muted">可查看最新区块或输入高度查询</span>
        </div>
        <div className="block-controls">
          <label className="field">
            <span className="field__label">区块高度</span>
            <input
              value={requestedHeight}
              onChange={(e) => setRequestedHeight(e.target.value)}
              placeholder={latestHeight || '例如：1'}
              spellCheck={false}
            />
          </label>
          <button onClick={() => fetchBlock()} disabled={blockLoading}>
            {blockLoading ? '查询中…' : '获取区块'}
          </button>
        </div>
        {blockError && <p className="error">{blockError}</p>}

        {block && (
          <div className="block-card">
            <div className="block-card__row">
              <span className="muted">链 ID</span>
              <strong>{block.block.header.chain_id}</strong>
            </div>
            <div className="block-card__row">
              <span className="muted">高度</span>
              <strong>{block.block.header.height}</strong>
            </div>
            <div className="block-card__row">
              <span className="muted">时间</span>
              <strong>{new Date(block.block.header.time).toLocaleString()}</strong>
            </div>
            <div className="block-card__row">
              <span className="muted">区块哈希</span>
              <code className="mono">{block.block_id.hash}</code>
            </div>
            <div className="block-card__row">
              <span className="muted">提议者</span>
              <code className="mono">{block.block.header.proposer_address}</code>
            </div>
            <div className="block-card__row">
              <span className="muted">交易数</span>
              <strong>{txTotal}</strong>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>交易记录</h2>
          <span className="muted">全部交易（按高度倒序，批量拉取）</span>
        </div>
        <div className="actions">
          <button onClick={fetchTxs} disabled={txLoading}>
            {txLoading ? '刷新中…' : '刷新交易列表'}
          </button>
          <span className="muted">总交易数：{txTotal}</span>
        </div>
        {txError && <p className="error">{txError}</p>}

        {txs.length > 0 ? (
          <div className="tx-list">
            {txs.map((tx) => (
              <div key={tx.hash} className="tx-item">
                <div className="tx-item__row">
                  <span className="muted">交易哈希</span>
                  <code className="mono">{shorten(tx.hash)}</code>
                </div>
                <div className="tx-item__row">
                  <span className="muted">高度</span>
                  <strong>{tx.height}</strong>
                </div>
                <div className="tx-item__row">
                  <span className="muted">执行结果</span>
                  <strong className={tx.tx_result.code === 0 ? 'tag tag--success' : 'tag tag--error'}>
                    {tx.tx_result.code === 0 ? 'Success' : `Error ${tx.tx_result.code}`}
                  </strong>
                </div>
                <div className="tx-item__row">
                  <span className="muted">Gas</span>
                  <span>
                    {tx.tx_result.gas_used}/{tx.tx_result.gas_wanted}
                  </span>
                </div>
                {tx.tx_result.log ? (
                  <div className="tx-item__row">
                    <span className="muted">日志</span>
                    <span className="tx-log">{tx.tx_result.log}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          !txLoading && <p className="muted">暂无交易</p>
        )}
      </section>
      </div>

    </div>
  )
}

export default App
