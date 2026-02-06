#!/usr/bin/env python3
"""
腾讯云 CVM 自动化创建脚本
用于快速创建 Linux 沙箱环境并进行 SSH 连接

使用前准备：
1. 安装依赖: pip install tencentcloud-sdk-python
2. 配置环境变量或修改脚本中的密钥：
   - TENCENTCLOUD_SECRET_ID
   - TENCENTCLOUD_SECRET_KEY
   - 或使用腾讯云 CLI: pip install tencentcloud-cli && tencentcloud configure

作者: Wendy (OpenClaw Assistant)
"""

import os
import sys
import time
import json
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.cvm.v20170312 import cvm_client, models
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException


class CVMSandboxCreator:
    """CVM 沙箱环境创建器"""

    def __init__(self, secret_id=None, secret_key=None, region="ap-beijing"):
        """
        初始化 CVM 客户端

        Args:
            secret_id: 腾讯云 Secret ID（如不提供则从环境变量读取）
            secret_key: 腾讯云 Secret Key（如不提供则从环境变量读取）
            region: 地域，默认北京
        """
        self.secret_id = secret_id or os.getenv("TENCENTCLOUD_SECRET_ID")
        self.secret_key = secret_key or os.getenv("TENCENTCLOUD_SECRET_KEY")

        if not self.secret_id or not self.secret_key:
            raise ValueError("请设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY 环境变量")

        self.region = region
        self.client = self._init_client()

    def _init_client(self):
        """初始化 CVM 客户端"""
        cred = credential.Credential(self.secret_id, self.secret_key)
        httpProfile = HttpProfile(endpoint="cvm.tencentcloudapi.com")
        clientProfile = ClientProfile(httpProfile=httpProfile)
        return cvm_client.CvmClient(cred, self.region, clientProfile)

    def create_instance(
        self,
        image_id,
        instance_type="S5.MEDIUM4",
        password=None,
        key_ids=None,
        instance_name="auto-sandbox",
        internet_max_bandwidth_out=1,
        data_disks=None,
    ):
        """
        创建 CVM 实例

        Args:
            image_id: 镜像 ID（必填），如: img-xxx
            instance_type: 实例机型，默认 S5.MEDIUM4 (2核4G)
            password: 登录密码（与 key_ids 二选一）
            key_ids: SSH 密钥 ID 列表（与 password 二选一）
            instance_name: 实例名称
            internet_max_bandwidth_out: 公网带宽 Mbps
            data_disks: 数据盘配置列表，如 [{"DiskSize": 50, "DiskType": "CLOUD_PREMIUM"}]

        Returns:
            InstanceIdSet: 实例 ID 列表
        """
        if not password and not key_ids:
            raise ValueError("必须设置 password 或 key_ids")

        req = models.RunInstancesRequest()
        params = {
            "Placement": {"Zone": f"{self.region.replace('ap-', '')}-1"},
            "ImageId": image_id,
            "InstanceType": instance_type,
            "InstanceChargeType": "POSTPAID_BY_HOUR",  # 按量计费
            "InternetAccessible": {
                "PublicIpAssigned": True,
                "InternetChargeType": "TRAFFIC_POSTPAID_BY_HOUR",
                "InternetMaxBandwidthOut": internet_max_bandwidth_out,
            },
            "InstanceCount": 1,
            "InstanceName": instance_name,
            "LoginSettings": {},
            "EnhancedService": {
                "SecurityService": {"Enabled": False},
                "MonitorService": {"Enabled": True},
            },
        }

        if password:
            params["LoginSettings"]["Password"] = password
        if key_ids:
            params["LoginSettings"]["KeyIds"] = key_ids
        if data_disks:
            params["DataDisks"] = data_disks

        req.from_json_string(json.dumps(params))

        try:
            resp = self.client.RunInstances(req)
            print(f"✅ 实例创建请求成功，实例 ID: {resp.InstanceIdSet}")
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
                    elif status == "LAUNCH_FAILED":
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
                if instance.PublicIpAddresses:
                    return instance.PublicIpAddresses[0]
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

    parser = argparse.ArgumentParser(description="腾讯云 CVM 沙箱创建工具")
    parser.add_argument("--image-id", required=True, help="镜像 ID (img-xxx)")
    parser.add_argument("--type", default="S5.MEDIUM4", help="实例机型")
    parser.add_argument("--password", help="登录密码")
    parser.add_argument("--name", default="auto-sandbox", help="实例名称")
    parser.add_argument("--region", default="ap-beijing", help="地域")
    parser.add_argument("--wait", action="store_true", help="等待启动完成")

    args = parser.parse_args()

    try:
        creator = CVMSandboxCreator(region=args.region)
        instance_id = creator.create_instance(
            image_id=args.image_id,
            instance_type=args.type,
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
                        print(f"\n💡 删除命令: python {__file__} --delete {instance_id}")
            else:
                print(f"\n📝 实例 ID: {instance_id}")
                print(f"💡 查询状态: python {__file__} --status {instance_id}")

    except ValueError as e:
        print(f"⚠️ 配置错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
