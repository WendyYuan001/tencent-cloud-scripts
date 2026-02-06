#!/usr/bin/env python3
"""
腾讯云轻量应用服务器（Lighthouse）自动化创建脚本
用于快速创建 Linux 沙箱环境并进行 SSH 连接

使用前准备：
1. 安装依赖: pip install tencentcloud-sdk-python
2. 配置环境变量或修改脚本中的密钥：
   - TENCENTCLOUD_SECRET_ID
   - TENCENTCLOUD_SECRET_KEY

作者: Wendy (OpenClaw Assistant)
"""

import os
import sys
import time
import json
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.lighthouse.v20230603 import lighthouse_client, models
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException


class LighthouseSandboxCreator:
    """Lighthouse 沙箱环境创建器"""

    def __init__(self, secret_id=None, secret_key=None, region="ap-beijing"):
        """初始化客户端"""
        self.secret_id = secret_id or os.getenv("TENCENTCLOUD_SECRET_ID")
        self.secret_key = secret_key or os.getenv("TENCENTCLOUD_SECRET_KEY")

        if not self.secret_id or not self.secret_key:
            raise ValueError("请设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY 环境变量")

        self.region = region
        self.client = self._init_client()

    def _init_client(self):
        """初始化 Lighthouse 客户端"""
        cred = credential.Credential(self.secret_id, self.secret_key)
        httpProfile = HttpProfile(endpoint="lighthouse.tencentcloudapi.com")
        clientProfile = ClientProfile(httpProfile=httpProfile)
        return lighthouse_client.LighthouseClient(cred, self.region, clientProfile)

    def get_bundles(self, bundle_type="LARGE"):
        """
        获取套餐列表

        Args:
            bundle_type: 套餐类型，如 SMALL, MEDIUM, LARGE, XLARGE

        Returns:
            套餐列表
        """
        try:
            req = models.DescribeBundlesRequest()
            req.BundleTypes = [bundle_type] if bundle_type else None
            resp = self.client.DescribeBundles(req)
            return resp.BundleSet
        except TencentCloudSDKException as err:
            print(f"❌ 获取套餐失败: {err}")
            return []

    def get_images(self, image_type="APP_IMAGE"):
        """
        获取镜像列表

        Args:
            image_type: 镜像类型，APP_IMAGE(应用镜像), PRIVATE_IMAGE(自定义镜像)

        Returns:
            镜像列表
        """
        try:
            req = models.DescribeImagesRequest()
            req.ImageTypes = [image_type] if image_type else None
            resp = self.client.DescribeImages(req)
            return resp.ImageSet
        except TencentCloudSDKException as err:
            print(f"❌ 获取镜像失败: {err}")
            return []

    def create_instance(
        self,
        bundle_id,
        image_id,
        password=None,
        key_ids=None,
        instance_name="auto-sandbox",
    ):
        """
        创建 Lighthouse 实例

        Args:
            bundle_id: 套餐 ID（必填），如: BUNDLE_2C4G_5M
            image_id: 镜像 ID（必填），如: img-xxx
            password: 登录密码
            key_ids: SSH 密钥 ID 列表
            instance_name: 实例名称

        Returns:
            InstanceIdSet: 实例 ID 列表
        """
        if not password and not key_ids:
            raise ValueError("必须设置 password 或 key_ids")

        req = models.CreateInstancesRequest()
        params = {
            "BundleId": bundle_id,
            "ImageId": image_id,
            "InstanceName": instance_name,
            "Period": 1,  # 购买时长（月）
            "RenewFlag": "NOTIFY_AND_AUTO_RENEW",  # 到期续费
            "LoginConfiguration": {},
        }

        if password:
            params["LoginConfiguration"]["Password"] = password
        if key_ids:
            params["LoginConfiguration"]["KeyIds"] = key_ids

        req.from_json_string(json.dumps(params))

        try:
            resp = self.client.CreateInstances(req)
            print(f"✅ 实例创建请求成功")
            if resp.InstanceIdSet:
                print(f"   实例 ID: {resp.InstanceIdSet[0]}")
            return resp.InstanceIdSet[0] if resp.InstanceIdSet else None
        except TencentCloudSDKException as err:
            print(f"❌ 创建失败: {err}")
            return None

    def wait_for_running(self, instance_id, timeout=300):
        """等待实例状态变为 RUNNING"""
        print(f"⏳ 等待实例 {instance_id} 启动...")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                req = models.DescribeInstancesStatusRequest()
                req.InstanceIds = [instance_id]
                resp = self.client.DescribeInstancesStatus(req)

                if resp.InstanceStatusSet:
                    status = resp.InstanceStatusSet[0].InstanceState
                    print(f"   当前状态: {status}")

                    if status == "RUNNING":
                        print("✅ 实例已启动")
                        return True
                    elif status == "FAILED":
                        print("❌ 实例启动失败")
                        return False

            except TencentCloudSDKException:
                pass

            time.sleep(5)

        print(f"⏱ 超时: {timeout} 秒内未启动")
        return False

    def get_public_ip(self, instance_id):
        """获取实例公网 IP"""
        try:
            req = models.DescribeInstancesRequest()
            req.InstanceIds = [instance_id]
            resp = self.client.DescribeInstances(req)

            if resp.InstanceSet:
                instance = resp.InstanceSet[0]
                return instance.PublicAddresses[0] if instance.PublicAddresses else None
        except TencentCloudSDKException as err:
            print(f"❌ 获取公网 IP 失败: {err}")

        return None

    def delete_instance(self, instance_id):
        """删除实例"""
        try:
            req = models.TerminateInstancesRequest()
            req.InstanceIds = [instance_id]
            self.client.TerminateInstances(req)
            print(f"✅ 实例 {instance_id} 已删除")
            return True
        except TencentCloudSDKException as err:
            print(f"❌ 删除失败: {err}")
            return False


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(description="腾讯云 Lighthouse 沙箱创建工具")
    parser.add_argument("--list-bundles", action="store_true", help="列出可用套餐")
    parser.add_argument("--list-images", action="store_true", help="列出可用镜像")
    parser.add_argument("--bundle-id", help="套餐 ID (如 BUNDLE_2C4G_5M)")
    parser.add_argument("--image-id", help="镜像 ID (如 img-xxx)")
    parser.add_argument("--password", help="登录密码")
    parser.add_argument("--name", default="auto-sandbox", help="实例名称")
    parser.add_argument("--region", default="ap-beijing", help="地域")
    parser.add_argument("--wait", action="store_true", help="等待启动完成")

    args = parser.parse_args()

    try:
        creator = LighthouseSandboxCreator(region=args.region)

        # 列出套餐
        if args.list_bundles:
            bundles = creator.get_bundles()
            print("\n📦 可用套餐:")
            for b in bundles[:10]:  # 只显示前 10 个
                print(f"   {b.BundleId}: {b.BundleDisplayName} - {b.Price}元/月")
            return

        # 列出镜像
        if args.list_images:
            images = creator.get_images()
            print("\n🖼 可用镜像:")
            for img in images[:10]:
                print(f"   {img.ImageId}: {img.ImageName}")
            return

        # 创建实例
        if args.bundle_id and args.image_id:
            instance_id = creator.create_instance(
                bundle_id=args.bundle_id,
                image_id=args.image_id,
                password=args.password,
                instance_name=args.name,
            )

            if instance_id:
                if args.wait:
                    if creator.wait_for_running(instance_id):
                        public_ip = creator.get_public_ip(instance_id)
                        if public_ip:
                            print(f"\n🌐 公网 IP: {public_ip}")
                            print(f"🔌 SSH 连接: ssh root@{public_ip}")
                else:
                    print(f"\n📝 实例 ID: {instance_id}")
        else:
            parser.print_help()

    except ValueError as e:
        print(f"⚠️ 配置错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
