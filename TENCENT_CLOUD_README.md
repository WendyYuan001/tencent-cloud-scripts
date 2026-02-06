# 腾讯云沙箱自动化工具

两个 Python 脚本用于快速创建和管理腾讯云的 Linux 沙箱环境。

## 📁 文件说明

| 文件 | 用途 |
|------|------|
| `tencent_cloud_cvm_creator.py` | 创建云服务器（CVM）实例 |
| `tencent_cloud_lighthouse_creator.py` | 创建轻量应用服务器（Lighthouse）实例 |

## 🔧 安装依赖

```bash
pip install tencentcloud-sdk-python
```

## 🔑 配置密钥

### 方法 1: 环境变量（推荐）
```bash
export TENCENTCLOUD_SECRET_ID="你的SecretId"
export TENCENTCLOUD_SECRET_KEY="你的SecretKey"
```

### 方法 2: 腾讯云 CLI
```bash
pip install tencentcloud-cli
tencentcloud configure
```

获取密钥地址：https://console.cloud.tencent.com/cam/capi

## 🚀 使用示例

### CVM（云服务器）

#### 1. 查看可用镜像
首先需要在控制台查看或使用 API 获取镜像 ID
https://console.cloud.tencent.com/cvm/image

#### 2. 创建实例
```bash
# 按量计费，自动等待启动
python tencent_cloud_cvm_creator.py \
  --image-id img-xxx \
  --password your_ssh_password \
  --name my-sandbox \
  --wait
```

参数说明：
- `--image-id`: 镜像 ID（必填）
- `--type`: 实例机型，默认 S5.MEDIUM4 (2核4G)
- `--password`: SSH 登录密码
- `--name`: 实例名称
- `--region`: 地域，默认 ap-beijing
- `--wait`: 等待实例启动完成

### Lighthouse（轻量应用服务器）

#### 1. 查看可用套餐
```bash
python tencent_cloud_lighthouse_creator.py --list-bundles
```

#### 2. 查看可用镜像
```bash
python tencent_cloud_lighthouse_creator.py --list-images
```

#### 3. 创建实例
```bash
python tencent_cloud_lighthouse_creator.py \
  --bundle-id BUNDLE_2C4G_5M \
  --image-id img-xxx \
  --password your_ssh_password \
  --name my-sandbox \
  --wait
```

参数说明：
- `--bundle-id`: 套餐 ID（必填）
- `--image-id`: 镜像 ID（必填）
- `--password`: SSH 登录密码
- `--name`: 实例名称
- `--region`: 地域，默认 ap-beijing
- `--wait`: 等待实例启动完成

## 📝 输出示例

```
✅ 实例创建请求成功，实例 ID: ['ins-xxx']
⏳ 等待实例 ins-xxx 启动...
   当前状态: PENDING
   当前状态: LAUNCHING
   当前状态: RUNNING
✅ 实例已启动
🌐 公网 IP: 1.2.3.4
🔌 SSH 连接: ssh root@1.2.3.4
```

## 💡 CVM vs Lighthouse 选择建议

| 场景 | 推荐 |
|------|------|
| 临时测试/开发 | CVM（按量计费） |
| 个人项目/博客 | Lighthouse（套餐制，更省钱） |
| 需要精细配置 | CVM（完全自定义） |
| 快速上手 | Lighthouse（配置简单） |

## 🔐 安全提示

1. **不要在脚本中硬编码密钥**
2. 使用 SSH 密钥比密码更安全
3. 及时删除不用的实例避免费用
4. 配置安全组限制访问来源 IP

## 📚 相关链接

- 腾讯云 CVM API: https://cloud.tencent.com/document/api/213
- 腾讯云 Lighthouse API: https://cloud.tencent.com/document/api/1207
- 腾讯云 SDK 文档: https://cloud.tencent.com/document/sdk

---

**作者**: Wendy (OpenClaw Assistant)
**日期**: 2026-02-06
