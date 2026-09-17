# GitHub Actions 自动部署

工作流 `.github/workflows/deploy.yml` 在 PR 中运行检查与测试；推送到 main 后，测试通过才部署。也可在 Actions 手动运行 main。部署目标是 Linux + systemd + Node.js 24 + Nginx 的单台服务器，不包含小程序上传发布。

每次仅上传 server、package 文件和部署脚本；数据库、微信密钥和本地开发数据不会上传。版本放在 `/opt/shadowtable/releases/`，`current` 软链接指向正在使用的版本。部署会短暂重启单进程，健康检查失败会回退代码；数据库不回滚，未来涉及不兼容数据库迁移时必须另行设计迁移与恢复流程。

## 一次性初始化服务器

以下以 Ubuntu/Debian 为例，由管理员执行。先安装 Node.js 24（确保 `/usr/bin/node` 可执行）、Nginx、curl、tar、util-linux、sudo、OpenSSH server。Node.js 的安装方式可按服务器现有管理方式选择；若路径不同，同时修改 service 与 release.sh 中的路径。

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin shadowtable
sudo install -d -o deploy -g deploy -m 755 /opt/shadowtable /opt/shadowtable/releases
sudo install -d -o shadowtable -g shadowtable -m 700 /var/lib/shadowtable
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo touch /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

使用专用于部署的 SSH 密钥，把公钥加入 `/home/deploy/.ssh/authorized_keys`；私钥保存到 GitHub Secret。运行服务的 shadowtable 账号与上传代码的 deploy 账号分开。

创建 `/etc/shadowtable.env`，root 所有、权限 600，填写：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DB_PATH=/var/lib/shadowtable/shadowtable.sqlite
DEV_AUTH=0
DEV_PANEL=0
WECHAT_APP_ID=真实AppID
WECHAT_APP_SECRET=真实AppSecret
# 网页版玩家入口（可选）：完整 HTTPS 源、不带末尾斜线或路径；配好后浏览器可直接访问
WEB_ORIGIN=https://api.example.com
```

Node 不自动读取 `.env`；systemd 负责加载此文件。密钥只保存在服务器。

从仓库复制服务配置，并启用开机启动（首次部署前没有 current，暂不启动）：

```bash
sudo install -m 644 deploy/shadowtable.service /etc/systemd/system/shadowtable.service
sudo systemctl daemon-reload
sudo systemctl enable shadowtable
```

通过 `sudo visudo -f /etc/sudoers.d/shadowtable-deploy` 写入以下精确授权。先确认 `command -v systemctl` 是 `/usr/bin/systemctl`：

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart shadowtable, /usr/bin/systemctl stop shadowtable
```

通过 `sudo visudo -c` 验证。不要授权 deploy 任意 sudo 命令。后续修改 service 文件需要管理员手动安装；工作流只更新应用代码。

## GitHub 配置

仓库 Settings → Environments 新建 `production`，将允许部署的分支限制为 main。若套餐不支持 Environment secrets，可使用仓库 Actions secrets；工作流仍引用 production 环境。需要完全自动部署时，不设置人工审批规则。

在 production 的 secrets（或仓库 Actions secrets）设置：

| 名称 | 内容 |
| --- | --- |
| DEPLOY_HOST | 服务器 IPv4 或 SSH 域名，不带协议 |
| DEPLOY_USER | `deploy` |
| DEPLOY_PORT | SSH 端口，可省略，默认 22 |
| DEPLOY_SSH_KEY | 部署专用 SSH 私钥全文，使用无交互口令的专用密钥 |
| DEPLOY_KNOWN_HOSTS | 经核验的服务器 SSH 主机公钥 known_hosts 行 |

known_hosts 应从可信管理连接核对服务器主机公钥指纹后生成，不要在工作流里临时 ssh-keyscan 并直接信任。非 22 端口对应的条目格式是 `[域名或IP]:端口 key-type public-key`，主机名应与 DEPLOY_HOST 一致。

GitHub 托管 runner 必须能通过 SSH 到达服务器；若防火墙严格限制固定来源，需配置合适的 runner/网络入口。服务器需要能通过 HTTPS 请求 `api.weixin.qq.com`。不要公开 8787。

提交并推送工作流到 main 后，在 Actions → Backend CI and deploy 查看运行。PR 只测试，不读取部署密钥。生产部署串行执行，正在执行的部署不会被新推送取消；并发待执行任务可能被较新的任务取代。

## HTTPS 与小程序

Actions 不负责 DNS、证书签发或 Nginx 初始化。先配置 API 域名和有效证书，再将以下配置中的域名、证书路径替换成实际值：

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /health {
        proxy_pass http://127.0.0.1:8787;
    }
    # 网页版玩家入口：与 API 同域托管，/ 落到服务端返回前端；/api/ 等更精确 location 优先匹配
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

执行 `sudo nginx -t` 后重新加载 Nginx，并安排证书自动续期。小程序 `miniprogram/config.js` 设置正式 HTTPS baseUrl 和 `devAuth: false`，在微信后台配置 request 合法域名。小程序发布独立操作。

## 验收与运维

```bash
sudo systemctl status shadowtable
sudo journalctl -u shadowtable -n 100 --no-pager
curl --fail https://api.example.com/health
```

工作流只验证服务器内部 `/health`，不验证公网 HTTPS、证书或微信登录；首次上线必须用真机验证登录、建房、加入、秘密操作以及重启后恢复房间。

- SQLite 开启 WAL：使用 SQLite 在线备份或停服备份整个数据目录，不能运行中只复制主文件。上线前配置定时异机备份。
- 只运行单个 Node 实例。不要启用 PM2 cluster 或多服务器共享 SQLite。
- 当前限流按连接 IP 计算，Nginx 后所有玩家共享登录 30 次/分钟、总请求 6000 次/分钟的 IP 额度。设置代理请求头不会自动修复；扩大规模前需修改后端的可信代理处理。
- 健康检查失败时自动回退上一版本代码；首次部署失败则停服。回退失败需要管理员检查日志。
- 历史版本暂不自动删除；定期清理不用的版本，至少保留当前版本和上一个可用版本。数据目录不会随版本清理。
- 手动回退最简单的方式是 revert main 上的问题提交并推送，让工作流重新部署。
- 若服务器已按旧说明把代码直接放在 `/opt/shadowtable`，先备份数据库，再迁移到本说明的 current/releases 布局并更新服务配置。

参考：[GitHub 部署控制](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)、[Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)。

## 正式测试与管理平台

新增 `/admin`，与仅本机使用的 `/dev` 分开。无需开启 `DEV_AUTH` 或 `DEV_PANEL`；生产环境继续保持两者为 0。

在服务器 `/etc/shadowtable.env` 添加：

```dotenv
ADMIN_ORIGIN=https://api.example.com
ADMIN_KEY=至少32字符的随机管理密钥
```

使用 `openssl rand -hex 32` 生成密钥，将它安全保存到环境文件及管理员密码管理器中，不放入小程序、仓库或 URL。`ADMIN_ORIGIN` 必须与浏览器地址的源完全一致，不带末尾斜线或路径。正式环境只允许 HTTPS。两项留空时管理平台关闭。

在同一个 Nginx HTTPS server 中增加：

```nginx
location = /admin {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $http_host;
}
location /admin/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $http_host;
}
```

`/api/admin/` 由原有 `/api/` location 转发。确保该 location 也保留浏览器 Host（建议 `proxy_set_header Host $http_host;`，非标准 HTTPS 端口必须保留端口号），并且不要移除 Origin/Cookie 请求头，也不要对管理页面或 API 配置代理缓存。

部署新代码、更新环境文件后，执行 `sudo nginx -t`、`sudo systemctl reload nginx` 和 `sudo systemctl restart shadowtable`。浏览器打开 `https://api.example.com/admin`，输入管理密钥即可登录。服务重启、密钥轮换或退出登录后，管理员会话失效，需要重新登录。

### 使用流程

1. 正式玩家先在小程序创建房间。平台显示房间号、板子、人数和阶段，分页每页 50 条。
2. 在准备阶段选择“开启陪测”，输入房间号和操作原因。直接使用原房间和原玩家，无需重新建房。
3. 小程序显示“测试房间 · 陪测已开启”（需要发布本次小程序改动）；打开“陪测台”，输入原房间号，添加或补齐测试玩家，继续使用原有准备、投票、任务和技能测试功能。
4. 已发牌的房间不能新加玩家。要测试已有对局，先由房主结束并同房重开，再开启陪测。
5. 完成后回到准备阶段清空陪测玩家，再关闭陪测。管理员会话过期后可重新登录，用“清理陪测座位”清除旧账号并保留真人；如果房主是陪测账号，会转交给在座真人。
6. “终止对局”“同房重开”和“删除房间”均需输入房间号及原因。终止不判胜负；删除不可在平台恢复。最近 100 条审计记录可在页面查看，完整记录存 SQLite `admin_audit`，包括陪测操作类型，不记录秘密票型/目标。

当前为单管理员共享密钥模式，审计记录统一标记管理操作，不能区分多个使用者；尚未实现多管理员角色、找回密码或 MFA。管理员会话保存在内存中，有效期 8 小时；浏览器使用 HttpOnly、Secure、SameSite=Strict Cookie。管理密钥不存入浏览器存储。登录全局限制每分钟10次。

陪测玩家凭据绑定当前管理员会话和指定房间，不能单独使用、跨房间或创建新房。退出/重启后旧凭据不可用。陪测台只查看和操作它创建的账号；管理概览不暴露真人身份、OpenID 或秘密行动。陪测房间不会自动恢复为正式房间，需清理后明确关闭。

数据仍使用现有 SQLite，启动会自动新增审计表，无需手动建表。部署不会自动修改 Nginx 或环境文件；这些配置只需管理员初始化一次。管理写操作结果不确定时，先刷新房间列表和审计记录确认，不要连续提交删除或终止。

## 网页版玩家入口

为应对小程序备案未通过的情况，提供与 API 同域托管的移动端网页版（`https://<域名>/`），登录方式为匿名访客，功能与小程序对等。备案通过后小程序仍是主入口；网页版不改变任何小程序代码。

在 `/etc/shadowtable.env` 配置 `WEB_ORIGIN`（上文已加入示例）为完整 HTTPS 源、不带末尾斜线或路径，例如 `https://api.example.com`。留空时网页版整体关闭，根路径仍返回 401，行为与之前一致。本地开发用 `npm run dev` 已自动设置 `WEB_ORIGIN=http://127.0.0.1:8787`，一条命令即可在浏览器打开 `http://127.0.0.1:8787/` 联调。

Nginx 的 `location / { return 404; }` 需改为 `proxy_pass`（上文 HTTPS 配置示例已改），并保留浏览器 Host（`proxy_set_header Host $http_host;`）与 Origin/`Sec-Fetch-Site` 请求头——访客登录据此校验同源，缺失会导致 403。`/api/`、`/health`、`/admin` 等更精确的 location 优先匹配，小程序的域名与请求路径完全不受影响。

部署新代码、更新环境文件后，执行 `sudo nginx -t`、`sudo systemctl reload nginx` 和 `sudo systemctl restart shadowtable`（网页前端随 `server/web/` 一起部署，无需额外构建）。验证：

```bash
curl -i https://api.example.com/                    # 返回 HTML，含 Content-Security-Policy
curl -i -X POST https://api.example.com/api/guest-login -H 'Origin: https://api.example.com'  # 返回 {"token":...}
```

玩家用浏览器打开根地址即进入，建房/加入流程与小程序一致；通过复制房间的“邀请链接”（`https://<域名>/?code=XXXXXX`）可直接直达加入页。数据存在同一 SQLite，小程序与网页玩家可混用同一房间。访客登录沿用登录限流与来源校验；访客只是换个登录通道，不会获得任何特权。
