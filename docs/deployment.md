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
    location / { return 404; }
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
