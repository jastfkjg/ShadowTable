# EC2 容器部署

ShadowTable 使用单个 Node 24 容器提供网页和 API，SQLite 持久化到 `/opt/shadowtable/data`。独立 Caddy 网关由相邻 `jastcraft-infra` 仓库管理；本项目不安装 Nginx，也不部署 Caddy。首次网关切换必须先遵循该仓库 README。

## 1. 初始化服务器

需要 Linux、Docker Engine、Compose >=2.24、Python3、curl、tar、flock 和 SSH。以下 `deploy` 替换为实际部署账号。账号需具备 Docker 权限（等同宿主机高权限）。

```bash
sudo install -d -o deploy -g deploy -m 700 /opt/shadowtable /opt/shadowtable/releases /opt/shadowtable/backups
sudo install -d -o 1000 -g 1000 -m 700 /opt/shadowtable/data
```

容器以 Node 镜像的 node 用户 UID/GID 1000 运行。数据目录必须可写；如果使用 user namespace remap/rootless Docker，需按该运行环境调整宿主 UID 映射。

将 `deploy/cloud/app.env.example` 上传为 `/opt/shadowtable/app.env`，权限 600、部署用户所有，设置：

```dotenv
WEB_ORIGIN=https://table.example.com
ADMIN_ORIGIN=
ADMIN_KEY=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

`WEB_ORIGIN` 与网关 SHADOWTABLE_DOMAIN 一致，HTTPS、不含末尾斜线。管理员入口需要两项同时设置：`ADMIN_ORIGIN` 等于 WEB_ORIGIN，`ADMIN_KEY` 用 `openssl rand -hex 32` 生成。网页版访客不需要微信凭据；小程序登录才需要。含 `$` 的值在 env 文件用单引号包围，避免 Compose 插值。环境由 Compose 注入，Node 不自动加载 .env。

生产模式、监听地址、SQLite 路径及关闭开发入口由 Compose 固定。只运行一个 app，禁止 scale/PM2 cluster。不映射 8787 到宿主机，流量经 shadowtable_proxy 网络进入。

## 2. 镜像和 GitHub Actions

沿用 echooo 的 ACR 方式，为 ShadowTable 建立独立镜像仓库。服务器部署用户 `docker login <ACR_REGISTRY>`，账号需有拉取权限。

在 GitHub 仓库配置 Variables：

| 名称 | 内容 |
| --- | --- |
| ACR_REGISTRY | 控制台给出的公网 aliyuncs.com registry，不带协议 |
| ACR_NAMESPACE | 命名空间 |
| ACR_REPOSITORY | ShadowTable 独立仓库名称 |

新建 `production` Environment，将部署分支限制为 main，配置 Secrets（也可使用仓库 Secrets）：

| 名称 | 内容 |
| --- | --- |
| ACR_USERNAME / ACR_PASSWORD | ACR 推送凭据 |
| SSH_HOST / SSH_PORT / SSH_USER | EC2 SSH 地址、端口（默认22）、部署用户 |
| SSH_KEY | 专用 SSH 私钥 |
| SSH_KNOWN_HOSTS | 已经可信渠道核验的服务器 host key |

旧流程的 `DEPLOY_*` Secrets 不再使用。GitHub runner 必须能访问 SSH 和镜像仓库。首次服务器尚未初始化时先禁用 Actions，准备就绪后再启用并手动运行 main。

PR 只验证；push main 和手动 main 发布先运行语法、单元测试、部署故障测试和容器冒烟测试，再构建 amd64/arm64 镜像。发布到独立 ACR 仓库并锁定 digest，通过 SSH 上传部署脚本到新 release。工作流不上传本地数据库、私钥、环境文件或小程序。

服务器发布流程：检查配置及数据权限 → 拉镜像 → 停止写入 → 备份整个数据目录（含 WAL）→ 启动单实例并等待健康 → 检查公网 `/health` JSON → 更新 current/previous。

失败后恢复上一容器版本；首次部署失败则停服。自动回退只回退应用，不恢复数据库：因此此通道只允许向后兼容的数据库变更。不兼容迁移必须单独安排维护及恢复方案。备份失败会中止发布并尝试恢复旧应用。

## 3. 从旧 systemd 方案迁移（仅已部署过的服务器需要）

旧 `deploy/release.sh` 和 service 文件已从仓库移除，不能再用旧流水线部署。

1. 停止并禁用 `shadowtable.service`，确认没有其他进程写 SQLite。
2. 备份 `/var/lib/shadowtable` 整个目录及 `/etc/shadowtable.env`。
3. 将数据库目录内容（包含 WAL/SHM，如存在）复制到 `/opt/shadowtable/data`，设所有者 1000:1000、目录权限700；不要复制开发机数据。
4. 将旧环境中的适用项安全迁到 app.env；Compose 固定的 HOST/PORT/DB_PATH 不必复制。
5. 记录旧 current 指向，将旧 `/opt/shadowtable/current` 软链接移到 `legacy-current`，不要删除旧 releases。新容器脚本拒绝把 systemd release 当作回退版本。
6. 网关与代理网络就绪后首次发布容器，验证数据后完成迁移。

首次容器发布失败时不会自动恢复 systemd。如需回退，先停容器，再按数据兼容性恢复原数据备份、旧 current 和服务。严禁同时运行旧服务与新容器。

## 4. 验收及运维

```bash
bash /opt/shadowtable/current/compose.sh ps
bash /opt/shadowtable/current/compose.sh logs --tail 100 app
curl --fail https://table.example.com/health
curl --fail https://table.example.com/
```

用浏览器测试访客登录、建房、另一台设备加入、秘密操作和重启恢复；启用后台时测试 `/admin`。网页与 API 同域，由网关整站代理，保留 Host/Origin/Sec-Fetch-Site；不需要配置 CORS 或前端构建。

发布脚本中的公网检查不替代业务验收。网关异常时会导致发布失败并回退应用；本项目不会修改或重启网关。

每次发布有停写备份，但不代替定时备份。安排 SQLite 在线备份或维护窗口内停服备份，并复制到异机/对象存储，设置保留周期及恢复演练。不要运行中只复制 sqlite 主文件，不要把备份放到公开静态目录。日志已限制大小和数量；定期清理历史 release、镜像和备份，至少保留当前及上一版本。

需要手工应用回退时，在 `/opt/shadowtable/deploy.lock` 锁下停止当前 app，用 previous 的 compose.sh 启动并健康检查，再更新 current。不得在旧版本不兼容当前 schema 时这样操作；数据库恢复需停写并明确数据损失范围。

当前后端以连接 IP 限流，代理后玩家共享代理 IP 额度（登录30次/分钟，总请求6000次/分钟）；设置转发头不会自动改变这一行为。扩大规模前需实现可信代理 IP 处理。

小程序发布独立进行：配置真实 AppID/AppSecret、HTTPS baseUrl 和 request 合法域名，关闭 devAuth，再单独上传发布。
