# 部署

## GitHub Pages 演示

[在线演示](https://superjuice666.github.io/sorane-player/?song=strings)使用 STRiNGS 展示全曲、逐句、逐段练习。

`.github/workflows/pages.yml` 在 main 更新时构建并发布网站。歌曲包由 Release 提供，`examples/demo-site.json` 固定下载地址和 SHA256；构建程序校验后生成静态网站。

```sh
python -m lyric_player.demo_site
```

修改演示曲目时，上传新的歌曲包并更新配置，再推送 main。GitHub 仓库的 Pages 发布源设为 GitHub Actions。原曲、读音与分块在页面中按播放位置加载，缓存由浏览器保存。

## 静态站点

运行 `python -m lyric_player build`，将 `build/` 作为网站根目录。网页、曲库和音频资源均由静态服务器提供。

HTML、JavaScript、CSS 和 JSON 应重新验证缓存；`assets/` 使用内容哈希，可以设置一年 immutable 缓存。更新时发布完整构建，保留一段时间的旧哈希音频，供已打开的页面继续播放。

## 本地预览

```sh
python -m server
```

默认地址为 <http://127.0.0.1:8080>。环境变量 `BUILD_DIR`、`BIND_HOST` 和 `PORT` 分别设置网站目录、监听地址和端口。

## Docker Compose

先在宿主机生成 `build/`，再启动容器：

```sh
cp .env.example .env
docker compose up -d --build
```

Compose 从 `.env` 读取 `BIND_ADDRESS` 和 `PORT`。默认入口为 <http://127.0.0.1:8080>。容器以 UID/GID 10001 运行，构建目录以只读方式挂载。

公网服务可通过 Caddy 或 Nginx 提供 HTTPS 和缓存控制。例如 Caddy：

```caddyfile
practice.example.com {
    root * /srv/sorane-player/build
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    @code not path /assets/*
    header @code Cache-Control "no-cache"
    file_server
}
```

## 更新和回退

1. 在新目录生成并校验构建。
2. 保留当前构建，发布新目录。
3. 检查歌曲列表、歌词选择和实际播放。
4. 需要回退时，将网站根目录指向保留的构建。
