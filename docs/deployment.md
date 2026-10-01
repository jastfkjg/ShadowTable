# AWS / 阿里云容器部署

ShadowTable 使用单个 Node 24 容器提供网页和 API，SQLite 持久化到 `/opt/shadowtable/data`。业务仓库管理应用发布、业务配置及数据库迁移；相邻 `../jastcraft-infra` 管理云资源、主机初始化、独立 Caddy 网关与备份。EC2 与阿里云 ECS 共用发布逻辑。

**push main 只测试并构建镜像，已经移除自动部署。** 发布必须手动运行 **Deploy tested image**，选择目标与成功 CI 构建编号。服务器不会因推送业务代码或 infra 代码自动变更。

## 1. 准备主机与网关

先遵循 `jastcraft-infra/docs/multicloud.md`，选用现有虚拟机或 Terraform 新建主机。目标约定：

| 业务 Environment | infra 主机目标 | 用途 |
| --- | --- | --- |
| `aliyun-prod` | `aliyun-beijing-01` | 北京 ECS |
| `aws-prod` | `aws-singapore-01` | 新加坡 EC2，保留手动发布能力 |

每个目标必须指向自己的服务器。当前仅有新加坡 EC2 和北京 ECS 两台服务器，没有独立 staging 部署目标。部署目录、Compose 项目名和代理网络按单实例设计。跨云迁移时只有一边承担正式流量与写入。

需要 Linux、Docker Engine、Compose >=2.24、Python3、curl、tar、flock 和 SSH。infra 的 Ubuntu 初始化脚本会创建账号、目录与目标标记。现有 EC2 无需重装 Docker；可由部署账号补充目标标记：

```bash
printf '%s\n' aws-prod > /opt/shadowtable/deployment-target
printf '%s\n' aws-singapore-01 > /opt/gateway/deployment-target
```

首次应用部署必须先在目标主机部署网关，创建 `shadowtable_proxy`。只有 Caddy 对外映射 80/443，应用不映射 8787。服务器部署账号需要 Docker 权限。

如果不用 infra 初始化脚本，手工创建（以下 `deploy` 替换为实际账号）：

```bash
sudo install -d -o deploy -g deploy -m 700 /opt/shadowtable /opt/shadowtable/releases /opt/shadowtable/backups
sudo install -d -o 1000 -g 1000 -m 700 /opt/shadowtable/data
```

容器以 UID/GID 1000 运行；rootless/user namespace 模式需调整映射。将 `deploy/cloud/app.env.example` 上传为 `/opt/shadowtable/app.env`，部署用户所有、权限 600，设置：

```dotenv
WEB_ORIGIN=https://table.example.com
ADMIN_ORIGIN=
ADMIN_KEY=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

`WEB_ORIGIN` 与该主机网关的 `SHADOWTABLE_DOMAIN` 一致，HTTPS、不含末尾斜线。后台启用时同时设置 `ADMIN_ORIGIN`（等于 WEB_ORIGIN）与至少32字符的 `ADMIN_KEY`，可用 `openssl rand -hex 32` 生成。小程序登录需微信凭据。含 `$` 的值使用单引号，避免 Compose 插值。Node 不自动加载 .env。

生产模式、监听地址、SQLite 路径、关闭开发入口由 Compose 固定。只运行一个 app，禁止 scale/PM2 cluster。

## 2. GitHub 构建与手动发布

### 2.1 配置构建镜像

在 **ShadowTable 仓库级别**设置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `ACR_REGISTRY` | 现有 ACR 仓库域名，不带协议或路径 |
| Variable | `ACR_NAMESPACE` | 现有命名空间，例如 `zzl-project` |
| Variable | `ACR_REPOSITORY` | 镜像仓库名称，例如 `shadowtable`，不带 tag 或 digest |
| Secret | `ACR_USERNAME` | 镜像推送账号 |
| Secret | `ACR_PASSWORD` | 镜像推送密码 |

继续使用现有 ACR 配置，workflow 自动将三个变量拼接为完整镜像路径，无需新增变量或改名。若凭据只配置在旧 `production` Environment，需要将同名凭据配置到仓库级别，因为 CI 构建不访问部署环境。

继续使用当前 ACR 即可同时服务 EC2/ECS。构建登录流程适用于支持 Docker 用户名/密码的 registry；以后切到 ECR 时另加 OIDC 登录适配，服务器发布脚本已接受 ECR、ACR、GHCR 等不可变镜像地址。

服务器部署用户单独执行 `docker login <registry>`，配置只读拉取凭据；Actions 的推送凭据不会上传到服务器。镜像清理策略需保留在用和回退 digest。

### 2.2 配置部署 Environment

在 Settings → Environments 建立需要的 `aliyun-prod`、`aws-prod`，将部署分支限制为 main。每个 Environment 配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `DEPLOY_TARGET` | 与 Environment 名称完全一致 |
| Secret | `SSH_HOST` | 该目标服务器地址 |
| Secret | `SSH_PORT` | SSH 端口，默认22 |
| Secret | `SSH_USER` | 部署账号 |
| Secret | `SSH_KEY` | 该目标专用私钥 |
| Secret | `SSH_KNOWN_HOSTS` | 经可信渠道核验的 host key；非22端口按 `[host]:port` 记录 |

将旧 AWS 部署信息迁到 `aws-prod`。移除仓库级共用 `SSH_*` Secrets，避免不同 Environment 回落到同一组主机凭据。旧 `production` 与 `DEPLOY_*` 配置不再用于业务发布。发布同时核对 Environment 的 `DEPLOY_TARGET` 与服务器的 `/opt/shadowtable/deployment-target`，不匹配则拒绝连接或发布。

GitHub runner 必须能访问目标 SSH 与镜像仓库；安全组填写实际管理机/runner 出口 CIDR。使用自托管 runner 时自行调整 workflow 的 `runs-on`。

### 2.3 操作发布与回退

1. 推送或合并代码到 main。**Container CI and build** 运行语法检查、单元测试、部署故障测试及容器冒烟测试，再构建 amd64/arm64 镜像。PR 只测试。
2. CI 成功后在 Summary 复制 **Build run ID**。对应 artifact `shadowtable-image` 保存 `image@sha256`、源码 SHA 和构建编号，保留90天。
3. Actions → **Deploy tested image** → Run workflow，分支选择 main，填写目标与 Build run ID。流程核验本仓库 main 的 CI 已成功，读取 artifact，通过共用 workflow 发布同一 digest；不重新构建。
4. 选择实际目标：`aliyun-prod` 对应北京 ECS，`aws-prod` 对应新加坡 EC2。迁移演练在尚未接正式流量的目标上使用临时域名和测试数据；两台主机独立限制部署并发。
5. 回退应用时选一个仍保留 artifact 和镜像的旧成功 Build run ID，再手动发布到同一目标。artifact 过期不能直接用此入口，需重新构建并重新验收，或维护窗口内按服务器手动回退流程处理。

发布使用该镜像对应源码版本的业务部署脚本，只上传部署文件，不上传数据库、真实 env、私钥或小程序。CI 不依赖任何生产服务器。

服务器发布顺序：检查配置及数据权限 → 拉镜像 → 停止写入 → 备份整个数据目录（含 WAL）→ 启动单实例并等待健康 → 检查本机网关 `/health` → 更新 current/previous。

健康检查通过 `curl --resolve <域名>:443:127.0.0.1` 访问目标主机的 Caddy，保留 Host/SNI 和 TLS 校验，不会因正式域名还指向旧 EC2 而误验旧服务。新主机必须已获得对应域名的有效证书；迁移演练可先用独立临时域名，正式切换时再调整域名配置与 DNS。

失败会恢复上一容器版本，首次失败则停服。自动回退只恢复应用，不恢复数据库；此通道只允许向后兼容的数据库变更。不兼容迁移单独安排维护与恢复方案。

### 2.4 从 EC2 迁移到 ECS

先用独立测试域名和测试数据验证 ECS、网关及发布流程。正式迁移降低 DNS TTL，在维护窗口停止旧应用写入，备份并复制完整 `/opt/shadowtable/data` 到 ECS，核对 UID/GID 和权限，部署已验收的镜像，再切 DNS、验证真实业务。旧应用保持停止，避免 DNS 缓存期间双边写入。新端开始写入后，回切 AWS 需要明确的数据同步/恢复步骤，不能只改 DNS。

继续使用原正式域名时，小程序 baseUrl 通常无需变化；换域名时同步合法 request 域名与客户端配置。中国内地节点的备案/接入手续见 infra 操作指南。

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

### 内置头像与关闭上传

小程序及网页版只提供 108 款内置头像，不再调用微信 `chooseAvatar` 或浏览器文件选择与裁切功能。资料接口只接受内置编号 `builtin:<id>`、清除值 `null` 或省略头像字段，拒绝用户图片数据和外部图片地址；资料请求体恢复为 8KB 上限。

先更新后端及网页版，再发布小程序。旧客户端尝试上传图片会收到明确失败响应；内置头像选择与昵称保存继续支持。已有上传头像保留在数据库中，个人资料、牌桌和排行榜继续展示，编辑昵称也保留原头像；用户可主动改选内置头像，无需数据库迁移或批量清理。

发布时核对微信后台隐私指引与实际功能一致；个人资料及已有头像的存储、展示仍应如实描述。
